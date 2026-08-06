import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function canvasEnergy(page: Page) {
  const screenshot = await page.locator("#scene-container canvas").screenshot();
  return page.evaluate(
    async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return -1;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let energy = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        energy += pixels[index] + pixels[index + 1] + pixels[index + 2];
      }
      return energy;
    },
    `data:image/png;base64,${screenshot.toString("base64")}`,
  );
}

test("complete desktop simulation reaches a second stage and restarts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /your room stays real/i }),
  ).toBeVisible();
  await expect(page.locator("[data-role='application']")).toHaveText("READY");
  await expect(page.locator("[data-role='player-health']")).toHaveText(
    "100/100",
  );
  await expect(page.locator("[data-role='guard']")).toHaveText("OPEN");
  await expect(page.locator("[data-role='xr-session']")).toHaveText("BROWSER");
  await expect(page.locator("[data-role='xr-hands']")).toHaveText("0/2");
  await expect(page.locator("[data-role='xr-geometry']")).toHaveText("0P / 0M");
  const depthDebug = page.locator("[data-command='depth-debug']");
  await expect(depthDebug).toHaveAccessibleName("Depth view: off");
  await expect(depthDebug).toHaveAttribute("aria-pressed", "false");
  await depthDebug.click();
  await expect(depthDebug).toHaveAccessibleName("Depth view: on");
  await expect(depthDebug).toHaveAttribute("aria-pressed", "true");
  await depthDebug.click();
  const emptySceneEnergy = await canvasEnergy(page);

  await page.getByRole("button", { name: "Enter desktop simulation" }).click();
  await page.getByRole("button", { name: "Load room fixture" }).click();
  await page.getByRole("button", { name: "Confirm labels + safety" }).click();
  await page.getByRole("button", { name: "Open portal" }).click();
  await expect(page.locator("[data-role='stage']")).toHaveText(
    "L1 · subway-platform",
  );
  await expect
    .poll(async () => Math.abs((await canvasEnergy(page)) - emptySceneEnergy))
    .toBeGreaterThan(1_000_000);
  await page.getByRole("button", { name: "Defeat wave" }).click();
  await expect(page.locator("[data-role='health']")).toHaveText("90/90");
  await page.getByRole("button", { name: "Defeat wave" }).click();
  await expect(page.locator("[data-role='health']")).toHaveText("126/126");
  await page.getByRole("button", { name: "Defeat wave" }).click();
  await expect(page.locator("[data-role='encounter']")).toHaveText(
    "BOSS_COMBAT",
  );
  await expect(page.locator("[data-role='health']")).toHaveText("384/384");
  await page.getByRole("button", { name: "Advance boss phase" }).click();
  await page.getByRole("button", { name: "Advance boss phase" }).click();
  await expect(page.locator("[data-role='boss']")).toHaveText("Phase 3");
  const firstStage = await page.locator("[data-role='stage']").textContent();
  await page.getByRole("button", { name: "Defeat boss" }).click();
  await expect(page.locator("[data-role='application']")).toHaveText("PLAYING");
  await expect(page.locator("[data-role='encounter']")).toHaveText("COMBAT");
  await expect(page.locator("[data-role='wave']")).toHaveText("1/3");
  await expect(page.locator("[data-role='health']")).toHaveText("63/63");
  await expect(page.locator("[data-role='stage']")).not.toHaveText(
    firstStage ?? "",
  );
  await expect(page.locator("[data-role='stage']")).toHaveText(
    "L2 · neon-city",
  );
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.locator("[data-role='encounter']")).toHaveText("IDLE");
  await expect(page.locator("[data-role='score']")).toHaveText("0");
  await expect(page.locator("[data-role='player-health']")).toHaveText(
    "100/100",
  );
  await expect(page.locator("[data-role='guard']")).toHaveText("OPEN");
  expect(errors).toEqual([]);
});

test("debug room safety bypass requires opt-in before continuing", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Enter desktop simulation" }).click();

  const continueButton = page.getByRole("button", {
    name: "Continue without room safety",
  });
  await expect(continueButton).toBeHidden();

  const toggle = page.locator("[data-command='safety-bypass']");
  await expect(toggle).toHaveAccessibleName("Debug safety: enforced");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(continueButton).toBeVisible();

  await continueButton.click();
  await expect(page.locator("[data-role='application']")).toHaveText(
    "STAGE_READY",
  );
  await expect(page.locator("[data-role='status']")).toContainText(
    "DEBUG BYPASS ACTIVE",
  );
});

test("mobile layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
  await expect(
    page.getByRole("button", { name: "Enter mixed reality" }),
  ).toBeVisible();
});
