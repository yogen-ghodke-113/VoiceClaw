import asyncio
import json
import os
import subprocess
import glob
from pathlib import Path
from typing import AsyncGenerator
import uuid

from google import genai
from google.genai import types

def run_bash_command(command: str) -> str:
    """Runs a bash/shell command and returns its stdout and stderr."""
    try:
        res = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=120)
        return f"STDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}\nEXIT_CODE: {res.returncode}"
    except Exception as e:
        return f"Error: {str(e)}"

def read_file(filepath: str) -> str:
    """Reads the contents of a file."""
    try:
        return Path(filepath).read_text(encoding="utf-8")
    except Exception as e:
        return f"Error: {str(e)}"

def write_file(filepath: str, content: str) -> str:
    """Writes content to a file. Overwrites if exists."""
    try:
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return f"Successfully wrote to {filepath}"
    except Exception as e:
        return f"Error: {str(e)}"

def list_directory(directory: str = ".") -> str:
    """Lists files and directories in the given path."""
    try:
        items = os.listdir(directory)
        return "\n".join(items) if items else "(empty directory)"
    except Exception as e:
        return f"Error: {str(e)}"


class GeminiRunner:
    def __init__(self, project_dir: str):
        self.project_dir = project_dir
        self.session_id = None
        self.model = "gemini-2.0-flash"
        self.effort = "high"  # Kept for compatibility with ui config
        self.client = genai.Client(http_options={"api_version": "v1alpha"})
        self._cancelled = False

    async def run(
        self,
        instruction: str,
        mode: str = "edit",
        allowed_tools: str | None = None,
        permission_mode: str | None = None,
    ) -> AsyncGenerator[dict, None]:
        
        self.session_id = self.session_id or str(uuid.uuid4())
        self._cancelled = False
        
        yield {
            "type": "status",
            "claude_running": True,
            "session_id": self.session_id,
        }

        full_instruction = f"You are working in directory: {self.project_dir}\n\nTask: {instruction}"

        messages = [
            types.Content(role="user", parts=[types.Part.from_text(text=full_instruction)])
        ]
        
        # We pass function names as strings if we handle execution manually, 
        # or function objects if we want the SDK to handle schema generation.
        tools = [run_bash_command, read_file, write_file, list_directory]

        config = types.GenerateContentConfig(
            tools=tools,
            temperature=0.0,
            system_instruction="You are an autonomous coding agent. Use your tools to inspect the codebase and modify files to fulfill the user's request. Always output a final summary.",
        )

        loop = asyncio.get_event_loop()
        max_turns = 15
        turn = 0

        while turn < max_turns and not self._cancelled:
            turn += 1
            
            try:
                response = await loop.run_in_executor(
                    None,
                    lambda: self.client.models.generate_content(
                        model=self.model,
                        contents=messages,
                        config=config,
                    )
                )
            except Exception as e:
                yield {
                    "type": "function_result",
                    "result": f"Gemini API Error: {str(e)}",
                    "is_error": True,
                    "session_id": self.session_id,
                }
                return

            if not response.candidates:
                break
                
            candidate = response.candidates[0]
            message = candidate.content
            
            if not message or not message.parts:
                break
                
            messages.append(message)

            has_tool_call = False
            tool_responses_parts = []
            final_text = ""

            for part in message.parts:
                if part.text:
                    final_text += part.text + "\n"
                    yield {
                        "type": "claude_event",
                        "subtype": "thinking",
                        "text": part.text,
                    }
                
                if part.function_call:
                    has_tool_call = True
                    fc = part.function_call
                    
                    yield {
                        "type": "claude_event",
                        "subtype": "tool_use",
                        "tool": fc.name,
                        "input": dict(fc.args) if fc.args else {},
                    }
                    
                    func_name = fc.name
                    args_dict = dict(fc.args) if fc.args else {}
                    
                    # Ensure paths are relative to project_dir if not absolute
                    def get_abs_path(p):
                        if os.path.isabs(p): return p
                        return os.path.join(self.project_dir, p)

                    try:
                        if func_name == "run_bash_command":
                            cmd = args_dict.get("command", "")
                            result_str = run_bash_command(cmd)
                        elif func_name == "read_file":
                            p = get_abs_path(args_dict.get("filepath", ""))
                            result_str = read_file(p)
                        elif func_name == "write_file":
                            p = get_abs_path(args_dict.get("filepath", ""))
                            result_str = write_file(p, args_dict.get("content", ""))
                        elif func_name == "list_directory":
                            p = get_abs_path(args_dict.get("directory", "."))
                            result_str = list_directory(p)
                        else:
                            result_str = f"Unknown tool: {func_name}"
                    except Exception as e:
                        result_str = f"Error executing tool: {str(e)}"
                    
                    tool_responses_parts.append(
                        types.Part.from_function_response(
                            name=fc.name,
                            response={"result": result_str}
                        )
                    )

            if has_tool_call:
                messages.append(
                    types.Content(role="user", parts=tool_responses_parts)
                )
            else:
                yield {
                    "type": "function_result",
                    "result": final_text.strip(),
                    "is_error": False,
                    "session_id": self.session_id,
                }
                return

        if turn >= max_turns:
            yield {
                "type": "function_result",
                "result": "Agent reached maximum turns.",
                "is_error": True,
                "session_id": self.session_id,
            }

    async def cancel(self):
        self._cancelled = True
