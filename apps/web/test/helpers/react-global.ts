// tsx compiles component JSX with the classic runtime under this tsconfig (jsx: preserve), so
// rendered components need React in scope. Import before any component.
import React from 'react';
Object.assign(globalThis, {React});
