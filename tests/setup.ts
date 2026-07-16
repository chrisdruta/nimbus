// bun test resolves the default export condition, under which the
// `server-only` marker package throws by design (Next resolves it to an
// empty module under its react-server condition). Stub it so unit tests
// can import lib/server modules. `client-only` needs no stub — its
// default condition is already the empty module.
import { mock } from "bun:test";
mock.module("server-only", () => ({}));
