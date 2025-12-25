# Line Numbers in Code

Some Markdown processors support line numbers.

## GitHub-Style Attributes

```javascript {.line-numbers}
const a = 1;
const b = 2;
const c = a + b;
console.log(c);
```

## Line Highlighting

```javascript {highlight=2-3}
function example() {
  const important = true;  // highlighted
  return important;        // highlighted
}
```

## Starting Line Number

```javascript {startLine=10}
// This starts at line 10
function loadData() {
  return fetch('/api/data');
}
```

## Manual Line Numbers (Plain Text)

```
1  | function hello() {
2  |   console.log("Hello");
3  | }
4  |
5  | hello();
```

## With Line References

See line 3 in the code below:

```python
def calculate(x, y):
    result = x + y
    return result  # Line 3: returns the sum

value = calculate(5, 10)
print(value)
```

The `return result` statement on line 3 sends back the sum.
