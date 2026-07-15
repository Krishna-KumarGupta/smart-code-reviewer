# module_a.py — circular dependency test fixture (2-file cycle: A → B → A)
# This file intentionally imports module_b, creating one edge of the cycle.
# The import is placed exactly on line 5 for test assertion purposes.
# fmt: off
from module_b import greet_b   # line 5: imports module_b


def greet_a(name: str) -> str:
    return f"Hello from A, {name}. And {greet_b(name)}"
