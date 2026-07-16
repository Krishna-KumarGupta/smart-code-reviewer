"""
slicing/symbols.py — tree-sitter symbol resolution.

Given a DiffHunk (file + line range), resolve which named symbol
(function, method, class) encloses that range, using tree-sitter AST parsing.

Supported languages: Python, JavaScript, TypeScript, Go, Java.
Falls back gracefully if a language is unsupported or tree-sitter fails.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# ─── Language detection ───────────────────────────────────────────────────────

_EXT_TO_LANG: dict[str, str] = {
    ".py":   "python",
    ".js":   "javascript",
    ".jsx":  "javascript",
    ".ts":   "typescript",
    ".tsx":  "typescript",
    ".go":   "go",
    ".java": "java",
}

# tree-sitter node types that represent named symbols we care about
_SYMBOL_NODE_TYPES: dict[str, list[str]] = {
    "python":     ["function_definition", "async_function_definition", "class_definition"],
    "javascript": ["function_declaration", "function_expression", "arrow_function",
                   "method_definition", "class_declaration"],
    "typescript": ["function_declaration", "function_expression", "arrow_function",
                   "method_definition", "class_declaration"],
    "go":         ["function_declaration", "method_declaration"],
    "java":       ["method_declaration", "constructor_declaration", "class_declaration"],
}

# Field names used to get the identifier node for a symbol
_NAME_FIELDS: dict[str, list[str]] = {
    "python":     ["name"],
    "javascript": ["name"],
    "typescript": ["name"],
    "go":         ["name"],
    "java":       ["name"],
}


def detect_language(filepath: str) -> str | None:
    """Return tree-sitter language name for a file path, or None if unsupported."""
    suffix = Path(filepath).suffix.lower()
    return _EXT_TO_LANG.get(suffix)


def _get_parser(lang_name: str):
    """
    Return a (parser, Language) tuple for the given language name.
    Tries tree_sitter_language_pack first, then falls back to individual packages.
    Returns None, None on failure.
    """
    try:
        from tree_sitter_language_pack import get_parser as _get  # type: ignore
        return _get(lang_name), None
    except Exception:
        pass

    try:
        import tree_sitter  # type: ignore
        parser = tree_sitter.Parser()
        # Try individual language packages
        lang_module_map = {
            "python":     "tree_sitter_python",
            "javascript": "tree_sitter_javascript",
            "typescript": "tree_sitter_typescript",
            "go":         "tree_sitter_go",
            "java":       "tree_sitter_java",
        }
        mod_name = lang_module_map.get(lang_name)
        if mod_name:
            import importlib
            mod = importlib.import_module(mod_name)
            lang = tree_sitter.Language(mod.language())
            parser.set_language(lang)
            return parser, lang
    except Exception as exc:
        logger.debug("[symbols] Could not load tree-sitter for %s: %s", lang_name, exc)
    return None, None


def _node_name(node, lang_name: str) -> str:
    """Try to extract the identifier name of a symbol node."""
    for field in _NAME_FIELDS.get(lang_name, ["name"]):
        child = node.child_by_field_name(field)
        if child:
            return child.text.decode(errors="replace")
    return "<anonymous>"


def find_enclosing_symbol(
    source: str,
    lang_name: str,
    line_start: int,  # 1-indexed
    line_end: int,    # 1-indexed
) -> tuple[str, int, int] | None:
    """
    Find the innermost named symbol that encloses [line_start, line_end].

    Returns (symbol_name, sym_start_line, sym_end_line) or None if not found.
    Lines are 1-indexed in the return value; tree-sitter uses 0-indexed internally.
    """
    parser, _ = _get_parser(lang_name)
    if parser is None:
        return None

    try:
        tree = parser.parse(source.encode())
    except Exception as exc:
        logger.debug("[symbols] Parse failed for lang=%s: %s", lang_name, exc)
        return None

    target_node_types = set(_SYMBOL_NODE_TYPES.get(lang_name, []))
    target_start = line_start - 1  # convert to 0-indexed
    target_end = line_end - 1

    best: tuple[str, int, int] | None = None
    best_size = float("inf")

    def _walk(node) -> None:
        nonlocal best, best_size
        if node.type in target_node_types:
            sym_start = node.start_point[0]
            sym_end = node.end_point[0]
            # Does this symbol enclose the target range?
            if sym_start <= target_start and sym_end >= target_end:
                size = sym_end - sym_start
                if size < best_size:
                    best_size = size
                    best = (_node_name(node, lang_name), sym_start + 1, sym_end + 1)
        for child in node.children:
            _walk(child)

    _walk(tree.root_node)
    return best


def extract_symbol_body(
    source_lines: list[str],
    sym_start: int,  # 1-indexed
    sym_end: int,    # 1-indexed
) -> str:
    """Extract the source lines for a symbol given 1-indexed start/end."""
    return "\n".join(source_lines[sym_start - 1 : sym_end])
