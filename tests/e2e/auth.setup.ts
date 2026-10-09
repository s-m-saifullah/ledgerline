import { test as setup } from "@playwright/test";
import { ownerSession, signInWithForm } from "./sign-in";

// One real sign-in through the form per run; every other test reuses the saved session.
setup("sign in once and save the owner session", async ({ page }) => {
  await signInWithForm(page);
  await page.context().storageState({ path: ownerSession });
});
