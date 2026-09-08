import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import {
  StateProvider,
  useCheckoutStore,
  useUiStore,
} from "../../src/components/providers/state-provider";

function Snapshot() {
  const draft = useCheckoutStore((state) => state.draft);
  const hydration = useUiStore((state) => state.hydration);
  const menuOpen = useUiStore((state) => state.menuOpen);
  return <output>{JSON.stringify({ draft, hydration, menuOpen })}</output>;
}
test("provider renders deterministic SSR defaults without browser storage or random keys", () => {
  const first = renderToString(
    <StateProvider>
      <Snapshot />
    </StateProvider>,
  );
  assert.equal(
    first,
    renderToString(
      <StateProvider>
        <Snapshot />
      </StateProvider>,
    ),
  );
  assert.match(first, /pending/);
  assert.doesNotMatch(first, /submitting/);
});
test("hooks give a clear error outside their provider", () => {
  assert.throws(() => renderToString(<Snapshot />), /inside StateProvider/);
});
