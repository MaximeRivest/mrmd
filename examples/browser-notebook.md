# Browser Notebook Demo

Testing JS execution in the browser - like Jupyter but for JavaScript. **Live sync test 2!** -- CLAUDE EDIT 1 -- ✨ **LIVE COLLAB MODE** ✨ - 🎉 THIS EDIT SHOULD APPEAR WHILE YOU TYPE! 🎉

## Test 1: Basic console.log

```js
console.log("Hello from JS notebook!fdfdsfs");
console.log("Multiple", "args", 123, {x: 1});
```
```output
Hello from JS notebook!fdfdsfs
Multiple args 123 {
  "x": 1
}
```

## Test 2: Return value (last expression)

```js
const nums = [1, 2, 3, 4, 5];
nums.map(n => n * n)
```
```output
[
  1,
  4,
  9,
  16,
  25
]
```

## Test 3: Variables persist across cells

```js
const greeting = "Hello";
```
```output
Hello
```

```js
// This should work if variables persist:
`${greeting}, ${name}!`
```
```output
Hello, World!
```

## Test 4: Functions persist

```js
function add(a, b) {
    return a + b;
}

function multiply(a, b) {
    return a * b;
}
```

```js
// Use the functions defined above:
add(2, 3) + multiply(4, 5)
```
```output
25
```

## Test 5: console.table

```js
const users = [
    { name: "Alice", role: "Dev", level: 5 },
    { name: "Bob", role: "Design", level: 3 },
];
console.table(users);
```
```output
name  | role   | level
------+--------+------
Alice | Dev    | 5    
Bob   | Design | 3    
```

## Test 6: Async/await

```js
const delay = ms => new Promise(r => setTimeout(r, ms));

async function fetchFakeData() {
    await delay(100);
    return { status: "ok", time: Date.now() };
}

await fetchFakeData()
```
```output
{
  "status": "ok",
  "time": 1764805514214
}
```

## Test 7: Error handling

```js
function divide(a, b) {
    if (b === 0) throw new Error("Division by zero!");
    return a / b;
}

divide(10, 2)
```
```output
5
```

```js
// This should show an error:
divide(10, 0)
```
```output
[error] Error: Division by zero!
divide@http://localhost:8765/ line 1094 > eval:2:24
@http://localhost:8765/ line 1094 > eval:2:13
@http://localhost:8765/ line 1094 > eval:2:31
```

## Test 8: DOM - Check what's available

```js
// What HTML elements exist in the document?
const allDivs = document.querySelectorAll('div');
console.log("Total divs in document:", allDivs.length);

// Check for our specific elements
const liveHtmlPreviews = document.querySelectorAll('.md-live-html');
console.log("Live HTML preview containers:", liveHtmlPreviews.length);

// Check what's inside them
liveHtmlPreviews.forEach((el, i) => {
    console.log(`Preview ${i}: children=${el.children.length}, innerHTML length=${el.innerHTML.length}`);
});
```
```output
Total divs in document: 390
Live HTML preview containers: 1
Preview 0: children=0, innerHTML length=0
```

## Test 9: HTML block rendering

```html
<div id="test-box" style="padding: 20px; background: #4CAF50; color: white; border-radius: 8px;">
    <h3>Test Box</h3>
    <p>ID: test-box</p>
    <button id="test-btn">Click Me</button>
</div>
```


```js
// Try to find the test box
const testBox = document.getElementById('test-box');
console.log("test-box found:", !!testBox);

if (testBox) {
    console.log("test-box innerHTML:", testBox.innerHTML.substring(0, 50));
}

// Also check via class
const greenBoxes = document.querySelectorAll('[style*="4CAF50"]');
console.log("Green boxes found:", greenBoxes.length);
```
```output
test-box found: true
test-box innerHTML: 
    <h3>Test Box</h3>
    <p>ID: test-box</p>
   
Green boxes found: 1
```

## Test 10: Interactive Button

```html
<div id="counter-demo" style="padding: 80px; background: #9C27B0; color: white; border-radius: 8px;">
    <h3>Click Counter</h3>
    <p>Count: <span id="count-display">0</span></p>
    <button id="increment-btn" style="padding: 10px 20px; font-size: 16px; cursor: pointer;">+1</button>
    <button id="decrement-btn" style="padding: 10px 20px; font-size: 16px; cursor: pointer;">-1</button>
    <button id="reset-btn" style="padding: 10px 20px; font-size: 16px; cursor: pointer;">Reset</button>
</div>
```



```js
// Wire up the counter buttons
const countDisplay = document.getElementById('count-display');
const incrementBtn = document.getElementById('increment-btn');
const decrementBtn = document.getElementById('decrement-btn');
const resetBtn = document.getElementById('reset-btn');

let count = 0;

incrementBtn.onclick = () => {
    count++;
    countDisplay.textContent = count;
};

decrementBtn.onclick = () => {
    count--;
    countDisplay.textContent = count;
};

resetBtn.onclick = () => {
    count = 0;
    countDisplay.textContent = count;
};

"Buttons wired! Click +1, -1, or Reset above."
```
```output
Buttons wired! Click +1, -1, or Reset above.
```

## Test 11: Direct DOM manipulation (no HTML block needed)

```js
// Create element directly with JS
const container = document.createElement('div');
container.id = 'js-created-box';
container.style.cssText = 'padding: 20px; background: #2196F3; color: white; border-radius: 8px; margin: 10px 0;';
container.innerHTML = '<h3>JS Created Box</h3><p>This was created by JavaScript!</p>';

// Append to body (or editor area)
document.body.appendChild(container);

"Created and appended a blue box to body!"
```
```output
Created and appended a blue box to body!
```

```js
// Verify it exists
const jsBox = document.getElementById('js-created-box');
console.log("JS created box found:", !!jsBox);
jsBox
```
```output
JS created box found: true
{}
```

 add a js code chunk that calls an ai service ## Test 12: Calling an AI service

```js
// Call OpenAI-compatible endpoint for a tiny chat completion
const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        // Replace with your own key or leave as-is for 401 demo
        "Authorization": "Bearer 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"
    },
    body: JSON.stringify({
        model: "gpt-4.1",
        messages: [{ role: "user", content: "Reply with a single JS joke." }],
        max_tokens: 40
    })
});

console.log("Status:", response.status, response.statusText);
const data = await response.json();
data
```
```output
Status: 200 
{
  "id": "chatcmpl-CirJwT7atMHgYhZUjYmWrhoVCHjPe",
  "object": "chat.completion",
  "created": 1764807432,
  "model": "gpt-4.1-2025-04-14",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Why did the JavaScript developer wear glasses?  \nBecause they couldn’t C#!",
        "refusal": null,
        "annotations": []
      },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 14,
    "completion_tokens": 16,
    "total_tokens": 30,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "audio_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0,
      "audio_tokens": 0,
      "accepted_prediction_tokens": 0,
      "rejected_prediction_tokens": 0
    }
  },
  "service_tier": "default",
  "system_fingerprint": "fp_09249d7c7b"
}
```



## Summary

Working:
- [ ] console.log
- [ ] Return values
- [ ] Variables persist
- [ ] Functions persist
- [ ] console.table
- [ ] Async/await
- [ ] Error handling
- [ ] HTML blocks render to DOM
- [ ] JS can query HTML block elements
- [ ] Interactive buttons work
- [ ] Direct DOM manipulation
 Copy
```

```python

```