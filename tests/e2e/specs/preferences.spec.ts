/// <reference types="@wdio/globals/types" />

/**
 * E2E — Préférences et thème
 * Scénarios : ouverture des préférences, changement de thème
 */

describe("Préférences", () => {
  before(async () => {
    await $('[data-testid="sidebar"]').waitForExist({ timeout: 15000 });
  });

  it("ouvre le panneau des préférences via Cmd+,", async () => {
    // Les préférences s'ouvrent via le raccourci clavier Cmd+,
    await browser.keys(["Meta", ","]);

    const modal = $('[data-testid="preferences-modal"]');
    await modal.waitForDisplayed({ timeout: 5000 });
    expect(await modal.isDisplayed()).toBe(true);
  });

  it("affiche le sélecteur de thème dans l'onglet Apparence", async () => {
    const appearanceTab = $('[data-testid="prefs-tab-appearance"]');
    if (await appearanceTab.isExisting()) {
      await appearanceTab.click();
    }

    const themeSelect = $('[data-testid="theme-select"]');
    await themeSelect.waitForExist({ timeout: 5000 });
    expect(await themeSelect.isDisplayed()).toBe(true);
  });

  it("change le thème et applique la modification", async () => {
    const themeSelect = $('[data-testid="theme-select"]');
    const currentTheme = await themeSelect.getValue();

    const options = await themeSelect.$$("option");
    const optionValues: string[] = [];
    for (const opt of options) {
      const val = await opt.getAttribute("value");
      if (val) optionValues.push(val);
    }

    const otherTheme = optionValues.find((v) => v !== currentTheme);
    if (!otherTheme) {
      console.warn("Un seul thème disponible — test ignoré");
      return;
    }

    await themeSelect.selectByAttribute("value", otherTheme as string);
    expect(await themeSelect.getValue()).toBe(otherTheme);
  });

  it("sauvegarde et ferme les préférences", async () => {
    await $('[data-testid="prefs-save"]').click();

    const modal = $('[data-testid="preferences-modal"]');
    await modal.waitForDisplayed({ timeout: 5000, reverse: true });
    expect(await modal.isDisplayed()).toBe(false);
  });
});
