# c.py — circular dep chain fixture: A → B → C → A
# The import is placed exactly on line 4 for test assertion purposes.
# (This comment ensures the import below is on line 4)
from a import func_a   # line 4: imports a — CLOSES THE CYCLE


def func_c():
    return func_a()
