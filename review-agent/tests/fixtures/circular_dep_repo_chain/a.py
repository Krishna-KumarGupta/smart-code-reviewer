# a.py — circular dep chain fixture: A → B → C → A
# The import is placed exactly on line 4 for test assertion purposes.
# (This comment ensures the import below is on line 4)
from b import func_b   # line 4: imports b


def func_a():
    return func_b()
