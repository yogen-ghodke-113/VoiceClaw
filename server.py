"""VoiceClaw backend — FastAPI server with WebSocket for Claude events."""

import argparse
import asyncio
import json
import os
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from checkpoint import GitCheckpoint, SessionManager
from gemini_agent import GeminiRunner
from context_bridge import ContextBridge
from function_router import FunctionRouter
from gemini_session import create_ephemeral_token
from stt_service import transcribe_audio

load_dotenv()

app = FastAPI(title="VoiceClaw")

# Global state
project_dir: str | None = None
claude_runner: GeminiRunner | None = None
function_router: FunctionRouter | None = None
context_bridge = ContextBridge()
session_manager: SessionManager | None = None
git_checkpoint: GitCheckpoint | None = None


def set_project(path: str):
    """Initialize all components for a project directory."""
    global project_dir, claude_runner, function_router, session_manager, git_checkpoint

    project_dir = path
    session_manager = SessionManager(project_dir)
    claude_runner = GeminiRunner(project_dir)
    function_router = FunctionRouter(claude_runner)
    git_checkpoint = GitCheckpoint(project_dir)

    # Restore Claude session ID if available
    if session_manager.claude_session_id:
        claude_runner.session_id = session_manager.claude_session_id

    print(f"Project set: {project_dir}")


# ── REST Endpoints ────────────────────────────────────────────


@app.get("/api/health")
async def health():
    return {"status": "ok", "project": project_dir}


@app.get("/api/project")
async def get_project():
    return {"path": project_dir, "active": project_dir is not None}


@app.post("/api/project")
async def set_project_endpoint(data: dict):
    path = data.get("path", "").strip()
    if not path:
        return JSONResponse({"error": "Path is required"}, status_code=400)

    resolved = Path(path).expanduser().resolve()
    if not resolved.is_dir():
        return JSONResponse({"error": "Directory not found"}, status_code=400)

    set_project(str(resolved))
    return {"ok": True, "path": project_dir}


@app.get("/api/projects/browse")
async def browse_dirs(path: str = "~"):
    resolved = Path(path).expanduser().resolve()
    if not resolved.is_dir():
        return JSONResponse({"error": "Not a directory"}, status_code=400)

    dirs = []
    try:
        for d in sorted(resolved.iterdir(), key=lambda x: x.name.lower()):
            if d.is_dir() and not d.name.startswith("."):
                dirs.append({"name": d.name, "path": str(d)})
    except PermissionError:
        pass

    return {
        "current": str(resolved),
        "parent": str(resolved.parent),
        "dirs": dirs,
    }


@app.get("/api/projects/pick")
async def pick_directory():
    """Open native OS folder picker dialog."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    path = filedialog.askdirectory()
    root.destroy()

    if not path:
        return {"path": None}
    return {"path": path}


@app.get("/api/token")
async def get_token():
    return create_ephemeral_token()


@app.get("/api/config")
async def get_config():
    prompt_path = Path(__file__).parent / "prompts" / "gemini_system.md"
    system_prompt = ""
    if prompt_path.exists():
        system_prompt = prompt_path.read_text(encoding="utf-8")
    return {
        "system_prompt": system_prompt,
        "model": "gemini-2.5-flash-native-audio-latest",
    }


@app.get("/api/narration-config")
async def get_narration_config():
    prompt_path = Path(__file__).parent / "prompts" / "narration_system.md"
    system_prompt = ""
    if prompt_path.exists():
        system_prompt = prompt_path.read_text(encoding="utf-8")
    return {
        "system_prompt": system_prompt,
        "model": "gemini-2.5-flash-native-audio-latest",
    }


@app.get("/api/session")
async def get_session():
    if not session_manager:
        return {"gemini_handle": None, "claude_session_id": None}
    return {
        "gemini_handle": session_manager.gemini_handle,
        "claude_session_id": session_manager.claude_session_id,
    }


@app.post("/api/session")
async def update_session(data: dict):
    if session_manager and "gemini_handle" in data:
        session_manager.gemini_handle = data["gemini_handle"]
    return {"ok": True}


@app.post("/api/transcribe")
async def transcribe(request: Request):
    """Transcribe audio via Gemini generateContent. Runs in parallel with Live API."""
    try:
        data = await request.json()
        chunks = data.get("audio_chunks", [])
        language = data.get("language", "en-US")
        if not chunks:
            return {"transcript": ""}
        transcript = await transcribe_audio(chunks, language)
        return {"transcript": transcript}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"transcript": "", "error": str(e)}, status_code=200)


@app.post("/api/claude-config")
async def set_claude_config(request: Request):
    if not claude_runner:
        return JSONResponse({"error": "No project selected"}, status_code=400)

    data = await request.json()
    model = data.get("model", "").strip()
    effort = data.get("effort", "").strip()

    valid_models = {"gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"}
    valid_efforts = {"low", "medium", "high", "max"}

    if model and model in valid_models:
        claude_runner.model = model
    if effort and effort in valid_efforts:
        claude_runner.effort = effort

    return {"model": claude_runner.model, "effort": claude_runner.effort}


@app.get("/api/claude-config")
async def get_claude_config():
    if not claude_runner:
        return {"model": "gemini-2.0-flash-exp", "effort": "medium"}
    return {"model": claude_runner.model, "effort": claude_runner.effort}


@app.get("/api/checkpoints")
async def list_checkpoints():
    if not git_checkpoint:
        return {"checkpoints": [], "error": "No project selected"}
    return {"checkpoints": git_checkpoint.list_checkpoints()}


@app.post("/api/checkpoints/restore")
async def restore_checkpoint(request: Request):
    if not git_checkpoint:
        return JSONResponse({"error": "No project selected"}, status_code=400)
    data = await request.json()
    commit_hash = data.get("hash", "").strip()
    if not commit_hash:
        return JSONResponse({"error": "No commit hash provided"}, status_code=400)
    result = git_checkpoint.restore(commit_hash)
    if not result["ok"]:
        return JSONResponse(result, status_code=400)
    return result


@app.get("/api/context")
async def get_context():
    return {"summary": context_bridge.get_summary()}


# ── WebSocket ─────────────────────────────────────────────────


@app.post("/api/cancel")
async def cancel_claude():
    """Kill any running Claude subprocess."""
    if claude_runner:
        try:
            await claude_runner.cancel()
            return {"ok": True, "message": "Claude operation cancelled"}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)
    return {"ok": True, "message": "No operation running"}


async def handle_function_call(websocket: WebSocket, msg: dict):
    """Process a function call from Gemini via the browser relay."""
    if not function_router:
        await websocket.send_json({
            "type": "function_result",
            "id": msg.get("id"),
            "name": msg.get("name"),
            "result": "No project selected. Please select a project folder first.",
            "is_error": True,
        })
        return

    call_id = msg["id"]
    name = msg["name"]
    args = msg.get("args", {})

    # Git checkpoint before write operations
    if name in ("code_task", "run_command") and git_checkpoint:
        git_checkpoint.create(label=f"{name}: {str(args)[:60]}")

    async for event in function_router.route(name, args):
        # Attach function call metadata to the final result
        if event.get("type") == "function_result":
            event["id"] = call_id
            event["name"] = name

            # Store in context bridge
            context_bridge.store(name, args, event.get("result", ""))

            # Update session ID
            if session_manager and event.get("session_id"):
                session_manager.claude_session_id = event["session_id"]

        try:
            await websocket.send_json(event)
        except Exception:
            break


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)

            if msg.get("type") == "function_call":
                asyncio.create_task(handle_function_call(websocket, msg))
            elif msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception:
        pass


# ── Static files ──────────────────────────────────────────────

static_dir = Path(__file__).parent / "frontend" / "dist"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True))


# ── Main ──────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="VoiceClaw server")
    parser.add_argument(
        "--project",
        default=None,
        help="Project directory for Claude Code (optional — can select in browser)",
    )
    parser.add_argument("--port", type=int, default=3333, help="Server port")
    args = parser.parse_args()

    if args.project:
        set_project(os.path.abspath(args.project))

    print(f"VoiceClaw starting on http://localhost:{args.port}")
    if project_dir:
        print(f"Project directory: {project_dir}")
    else:
        print("No project selected — select one in the browser")

    uvicorn.run(app, host="0.0.0.0", port=args.port)


if __name__ == "__main__":
    main()
