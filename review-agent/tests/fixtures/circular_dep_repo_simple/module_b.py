# module_b.py — circular dependency test fixture (2-file cycle: A → B → A)
# This file intentionally imports module_a, closing the cycle.
# The import is placed exactly on line 5 for test assertion purposes.
# fmt: off
from module_a import greet_a   # line 5: imports module_a — CLOSES THE CYCLE


def greet_b(name: str) -> str:
    return f"Hello from B, {name}. And {greet_a(name)}"
