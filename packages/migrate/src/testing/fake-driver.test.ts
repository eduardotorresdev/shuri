import { describeMigrationDriverContract } from "./index.js";
import { createFakeStore, type FakeStoreOptions } from "./fake-driver.js";

// The fake is the reference driver: it must pass the same contract every real driver does,
// in both atomicity modes.
const harness = (options: FakeStoreOptions) => ({
  async make() {
    const store = createFakeStore(options);
    return {
      adapter: store.adapter,
      injectFailure: store.injectFailure,
      cleanup: async () => {},
    };
  },
});

describeMigrationDriverContract("fake (atomic)", harness({ atomicity: "migration" }));
describeMigrationDriverContract("fake (non-atomic)", harness({ atomicity: "none" }));
