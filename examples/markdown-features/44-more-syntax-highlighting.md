# More Syntax Highlighting

Additional language examples for syntax highlighting.

## JSON

```json
{
  "name": "markdown-test",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.0.0",
    "typescript": "^5.0.0"
  },
  "features": ["code", "tables", "lists"]
}
```

## YAML

```yaml
name: CI Pipeline
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install dependencies
        run: npm install
      - name: Run tests
        run: npm test
```

## Bash / Shell

```bash
#!/bin/bash
echo "Hello, World!"

for i in {1..5}; do
    echo "Number: $i"
done

if [ -f "file.txt" ]; then
    cat file.txt
fi
```

## SQL

```sql
SELECT users.name, orders.total
FROM users
INNER JOIN orders ON users.id = orders.user_id
WHERE orders.total > 100
  AND orders.created_at > '2024-01-01'
ORDER BY orders.total DESC
LIMIT 10;
```

## Rust

```rust
fn main() {
    let message = "Hello, Rust!";
    println!("{}", message);

    let numbers: Vec<i32> = (1..=5).collect();
    for n in &numbers {
        println!("Number: {}", n);
    }
}
```

## Go

```go
package main

import "fmt"

func main() {
    message := "Hello, Go!"
    fmt.Println(message)

    for i := 1; i <= 5; i++ {
        fmt.Printf("Number: %d\n", i)
    }
}
```

## TypeScript

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

async function fetchUser(id: number): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
}
```
