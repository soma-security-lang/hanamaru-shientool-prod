import { describe, expect, it, vi } from "vitest";
import { deleteUploadObjectIfProvenUnreferenced } from "./service.js";

describe("upload completion compensation", () => {
  it("retains the object when the reference lookup fails", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);

    await expect(
      deleteUploadObjectIfProvenUnreferenced(
        async () => {
          throw new Error("database connection lost after COMMIT");
        },
        remove,
      ),
    ).resolves.toBeUndefined();

    expect(remove).not.toHaveBeenCalled();
  });

  it("retains a referenced object and deletes only a proven orphan", async () => {
    const referencedRemove = vi.fn().mockResolvedValue(undefined);
    const orphanRemove = vi.fn().mockResolvedValue(undefined);

    await deleteUploadObjectIfProvenUnreferenced(
      async () => ({ rowCount: 1 }),
      referencedRemove,
    );
    await deleteUploadObjectIfProvenUnreferenced(
      async () => ({ rowCount: 0 }),
      orphanRemove,
    );

    expect(referencedRemove).not.toHaveBeenCalled();
    expect(orphanRemove).toHaveBeenCalledOnce();
  });
});
