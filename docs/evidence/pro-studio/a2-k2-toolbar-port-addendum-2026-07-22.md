# A2 K2 Toolbar Port Addendum

- Source: `web/src/app/(user)/canvas/components/canvas-toolbar.tsx`
- Pin: `a2c52c7aacf68d825563b7455efa9c34f3db0123`
- Target: `apps/canvas/src/kernel-host/ported/k2-canvas-toolbar.tsx`
- Authorization: product-owner approved derivative inside the Pro Studio production boundary.

The port keeps the approved bottom dock, five node entry points, upload, owned
assets, appearance controls, delete, and clear actions. It removes the upstream
light/dark theme switch because Canvas bootstrap/system appearance remains the
only theme authority. It owns session-only appearance state and delegates every
graph mutation to the kernel host.
