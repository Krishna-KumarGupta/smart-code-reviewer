# b.py — circular dep chain fixture: A → B → C → A
# The import is placed exactly on line 4 for test assertion purposes.
# (This comment ensures the import below is on line 4)
from c import func_c   # line 4: imports c


def func_b():
    return func_c()
