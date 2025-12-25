"""
Markdown block parser for mrmd.

Parses markdown documents into structured blocks for execution.
"""

import re
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum


class BlockType(Enum):
    """Types of blocks in a markdown document."""
    TEXT = "text"
    CODE = "code"
    OUTPUT = "output"
    CHAT_USER = "chat_user"
    CHAT_ASSISTANT = "chat_assistant"
    FRONTMATTER = "frontmatter"


@dataclass
class Block:
    """A block in a markdown document."""
    type: BlockType
    content: str
    start_line: int
    end_line: int
    # Code block specific
    language: Optional[str] = None
    session: Optional[str] = None  # e.g., "python:main" -> session="main"
    # Metadata
    meta: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Document:
    """A parsed markdown document."""
    blocks: List[Block]
    frontmatter: Optional[Dict[str, Any]] = None
    raw_content: str = ""


# Regex patterns
CODE_FENCE_START = re.compile(r'^```(\w+)?(?::(\w+))?(.*)$')
CODE_FENCE_END = re.compile(r'^```\s*$')
FRONTMATTER_DELIMITER = re.compile(r'^---\s*$')
CHAT_USER = re.compile(r'^>\s*\*\*(?:User|Human)\*\*(?:\s+_to\s+(\w+)_)?\s*$', re.IGNORECASE)
CHAT_ASSISTANT = re.compile(r'^>\s*\*\*(?:Assistant|Claude|AI)\*\*\s*$', re.IGNORECASE)


def parse_blocks(content: str) -> List[Block]:
    """
    Parse markdown content into blocks.

    Supports:
    - Code blocks with optional language and session: ```python:main
    - Output blocks: ```output
    - Chat blocks: > **User** and > **Assistant**
    - Regular text blocks
    """
    lines = content.split('\n')
    blocks: List[Block] = []
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]

        # Check for code fence
        code_match = CODE_FENCE_START.match(line)
        if code_match:
            language = code_match.group(1) or ""
            session = code_match.group(2)  # Optional session name
            start_line = i
            i += 1
            code_lines = []

            # Collect until closing fence
            while i < n and not CODE_FENCE_END.match(lines[i]):
                code_lines.append(lines[i])
                i += 1

            block_type = BlockType.OUTPUT if language == "output" else BlockType.CODE

            blocks.append(Block(
                type=block_type,
                content='\n'.join(code_lines),
                start_line=start_line,
                end_line=i,
                language=language if language else None,
                session=session,
            ))
            i += 1  # Skip closing fence
            continue

        # Check for chat user block
        user_match = CHAT_USER.match(line)
        if user_match:
            target = user_match.group(1)  # e.g., "claude"
            start_line = i
            i += 1
            chat_lines = []

            # Collect quoted lines
            while i < n and lines[i].startswith('>'):
                # Strip the leading > and space
                chat_lines.append(lines[i][1:].lstrip() if len(lines[i]) > 1 else "")
                i += 1

            blocks.append(Block(
                type=BlockType.CHAT_USER,
                content='\n'.join(chat_lines).strip(),
                start_line=start_line,
                end_line=i - 1,
                meta={'target': target} if target else {},
            ))
            continue

        # Check for chat assistant block
        if CHAT_ASSISTANT.match(line):
            start_line = i
            i += 1
            chat_lines = []

            # Collect quoted lines
            while i < n and lines[i].startswith('>'):
                chat_lines.append(lines[i][1:].lstrip() if len(lines[i]) > 1 else "")
                i += 1

            blocks.append(Block(
                type=BlockType.CHAT_ASSISTANT,
                content='\n'.join(chat_lines).strip(),
                start_line=start_line,
                end_line=i - 1,
            ))
            continue

        # Regular text - collect until we hit something special
        start_line = i
        text_lines = []

        while i < n:
            line = lines[i]
            # Stop if we hit a code fence, chat block, or frontmatter
            if (CODE_FENCE_START.match(line) or
                CHAT_USER.match(line) or
                CHAT_ASSISTANT.match(line)):
                break
            text_lines.append(line)
            i += 1

        if text_lines:
            text_content = '\n'.join(text_lines)
            # Only add non-empty text blocks
            if text_content.strip():
                blocks.append(Block(
                    type=BlockType.TEXT,
                    content=text_content,
                    start_line=start_line,
                    end_line=i - 1,
                ))

    return blocks


def parse_document(content: str) -> Document:
    """
    Parse a full markdown document including frontmatter.

    Frontmatter is YAML between --- delimiters at the start of the document.
    """
    lines = content.split('\n')
    frontmatter = None
    body_start = 0

    # Check for frontmatter
    if lines and FRONTMATTER_DELIMITER.match(lines[0]):
        # Find closing delimiter
        for i in range(1, len(lines)):
            if FRONTMATTER_DELIMITER.match(lines[i]):
                # Parse YAML frontmatter
                try:
                    import yaml
                    frontmatter_text = '\n'.join(lines[1:i])
                    frontmatter = yaml.safe_load(frontmatter_text)
                except ImportError:
                    # YAML not available, store as raw text
                    frontmatter = {'_raw': '\n'.join(lines[1:i])}
                except Exception:
                    frontmatter = {'_raw': '\n'.join(lines[1:i])}
                body_start = i + 1
                break

    # Parse the body
    body_content = '\n'.join(lines[body_start:])
    blocks = parse_blocks(body_content)

    return Document(
        blocks=blocks,
        frontmatter=frontmatter,
        raw_content=content,
    )


def get_code_blocks(doc: Document, language: Optional[str] = None) -> List[Block]:
    """Get all code blocks, optionally filtered by language."""
    blocks = [b for b in doc.blocks if b.type == BlockType.CODE]
    if language:
        blocks = [b for b in blocks if b.language == language]
    return blocks


def get_chat_history(doc: Document) -> List[Dict[str, str]]:
    """Extract chat history as a list of messages."""
    messages = []
    for block in doc.blocks:
        if block.type == BlockType.CHAT_USER:
            messages.append({
                'role': 'user',
                'content': block.content,
            })
        elif block.type == BlockType.CHAT_ASSISTANT:
            messages.append({
                'role': 'assistant',
                'content': block.content,
            })
    return messages
