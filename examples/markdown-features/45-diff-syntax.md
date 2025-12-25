# Diff Syntax

Diff blocks show added and removed lines.

## Basic Diff

```diff
  unchanged line
- removed line
+ added line
  another unchanged line
```

## Code Changes

```diff
  function greet(name) {
-   console.log("Hello, " + name);
+   console.log(`Hello, ${name}!`);
    return true;
  }
```

## Configuration Change

```diff
  {
    "name": "my-app",
-   "version": "1.0.0",
+   "version": "1.1.0",
    "dependencies": {
-     "react": "^17.0.0",
+     "react": "^18.0.0",
      "lodash": "^4.17.0"
    }
  }
```

## File Comparison

```diff
--- a/old-file.js
+++ b/new-file.js
@@ -1,5 +1,6 @@
  const app = require('./app');
+ const logger = require('./logger');

  app.listen(3000, () => {
-   console.log('Server started');
+   logger.info('Server started on port 3000');
  });
```

## Multiple Hunks

```diff
  // Header section
- import { oldUtil } from './utils';
+ import { newUtil } from './helpers';

  // ... other code ...

  // Footer section
- export default OldComponent;
+ export default NewComponent;
```
