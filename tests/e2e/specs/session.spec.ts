/// <reference types="@wdio/globals/types" />

/**
 * E2E — Cycle de vie des sessions
 * Scénarios : création, navigation, renommage
 */

async function getSessionItems(): Promise<WebdriverIO.Element[]> {
  return (await $$('[data-testid="session-item"]')) as unknown as WebdriverIO.Element[];
}

async function sessionCount(): Promise<number> {
  return (await getSessionItems()).length;
}

describe("Sessions", () => {
  before(async () => {
    await $('[data-testid="sidebar"]').waitForExist({ timeout: 15000 });
  });

  it("affiche la sidebar au démarrage", async () => {
    expect(await $('[data-testid="sidebar"]').isDisplayed()).toBe(true);
  });

  it("crée une nouvelle session Claude", async () => {
    const countBefore = await sessionCount();

    await $('[data-testid="add-claude-session"]').click();

    await browser.waitUntil(
      async () => (await sessionCount()) > countBefore,
      { timeout: 10000, timeoutMsg: "La nouvelle session n'est pas apparue" }
    );

    expect(await sessionCount()).toBeGreaterThan(countBefore);
  });

  it("sélectionne une session via clic", async () => {
    if ((await sessionCount()) < 2) {
      await $('[data-testid="add-claude-session"]').click();
      await browser.pause(1000);
    }

    const items = await getSessionItems();
    await items[items.length - 1].click();

    expect(await $('[data-testid="session-item"].session-item--active').isExisting()).toBe(true);
  });

  it("renomme une session par double-clic", async () => {
    const items = await getSessionItems();
    await items[0].doubleClick();

    const renameInput = $('[data-testid="inline-rename-input"]');
    await renameInput.waitForExist({ timeout: 5000 });

    await renameInput.clearValue();
    await renameInput.setValue("Ma session test");
    await browser.keys(["Enter"]);

    await browser.waitUntil(
      async () => {
        const name = await $('[data-testid="session-item"] .session-item__name').getText();
        return name === "Ma session test";
      },
      { timeout: 5000, timeoutMsg: "Le renommage n'a pas été appliqué" }
    );
  });

  it("ferme une session avec le bouton ×", async () => {
    if ((await sessionCount()) < 2) {
      await $('[data-testid="add-claude-session"]').click();
      await browser.pause(1000);
    }

    const countBefore = await sessionCount();
    await $('[data-testid="session-item"] .session-item__close').click();

    await browser.waitUntil(
      async () => (await sessionCount()) < countBefore,
      { timeout: 5000, timeoutMsg: "La session n'a pas été fermée" }
    );

    expect(await sessionCount()).toBeLessThan(countBefore);
  });
});
