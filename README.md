# MRMD

markdown that runs.

```python
a = 3
h = 32
a +  h
```
```output:exec-1767398912520-y57ik
Out[1]: 35
```


```python
import sys; sys.executable
```
```output:exec-1767398915407-0kixc
Out[2]: '/home/maxime/Projects/mrmd/.venv/bin/python'
```


```python
%%code
random
```
```output:exec-1767398920168-zjb15
UsageError: Cell magic `%%code` not found.
```

```python
%magic
```
```output:exec-1767398921992-j4dxl
[status:running] [1/1]
=
IPython's 'magic' functions
===========================

The magic function system provides a series of functions which allow you to
control the behavior of IPython itself, plus a lot of system-type
features. There are two kinds of magics, line-oriented and cell-oriented.

Line magics are prefixed with the % character and work much like OS
command-line calls: they get as an argument the rest of the line, where
arguments are passed without parentheses or quotes.  For example, this will
time the given statement::

        %timeit range(1000)

Cell magics are prefixed with a double %%, and they are functions that get as
an argument not only the rest of the line, but also the lines below it in a
separate argument.  These magics are called with two arguments: the rest of the
call line and the body of the cell, consisting of the lines below the first.
For example::

        %%timeit x = numpy.random.randn((100, 100))
        numpy.linalg.svd(x)
:
```


```python
import matplotlib.pyplot as plt
plt.plot(ar)
plt.title("Test plot")
plt.show()
```
```output:exec-1767398967390-yaha7
[status:running] [1/1]
```




