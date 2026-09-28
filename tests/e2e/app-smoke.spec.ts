import { expect, test, type Page } from "@playwright/test";

async function waitForEither(page: Page, primary: ReturnType<Page["locator"]>, fallback?: ReturnType<Page["locator"]>) {
  await expect
    .poll(
      async () => {
        if (await primary.count()) return "primary";
        if (fallback && await fallback.count()) return "fallback";
        return "none";
      },
      { timeout: 60000 }
    )
    .not.toBe("none");
}

test.describe("app shell smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "quran-corpus-onboarding",
        JSON.stringify({
          version: "2",
          showOnStartup: false,
          completed: true,
        })
      );
    });
  });

  test("loads explore and reaches search workspace from mode nav", async ({ page }) => {
    await page.goto("/en");

    await expect(page.getByTestId("app-mode-nav")).toBeVisible();
    await expect(page.locator('[data-tour-id="main-viewport"]')).toBeVisible();
    await expect(page.getByTestId("app-mode-link-explore")).toHaveAttribute("data-active", "true");

    await Promise.all([
      page.waitForURL(/\/en\/search$/, { timeout: 60000 }),
      page.getByTestId("app-mode-link-search").click({ force: true }),
    ]);

    await expect(page.getByRole("heading", { name: /find roots, ayahs, lemmas, and glosses faster/i })).toBeVisible();
    await expect(page.getByTestId("app-mode-link-search")).toHaveAttribute("data-active", "true");
  });

  test("arabic explore keeps pinned panels docked to viewport edges", async ({ page }) => {
    await page.goto("/ar");
    await page.getByRole("button", { name: /الأدوات/i }).click();

    const layout = await page.evaluate(() => {
      const getRect = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;

        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);

        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          flexDirection: style.flexDirection,
        };
      };

      return {
        viewportWidth: window.innerWidth,
        toolsSidebar: getRect(".floating-sidebar"),
        selectionPanel: getRect(".viz-sidebar-stack"),
        selectionHeader: getRect(".ui-context-panel-header"),
      };
    });

    expect(layout.toolsSidebar).not.toBeNull();
    expect(layout.selectionPanel).not.toBeNull();
    expect(layout.selectionHeader).not.toBeNull();

    expect(layout.toolsSidebar!.left).toBeLessThanOrEqual(24);
    expect(layout.toolsSidebar!.right).toBeGreaterThan(layout.toolsSidebar!.left);
    expect(layout.toolsSidebar!.width).toBeGreaterThan(300);
    expect(layout.selectionPanel!.right).toBeGreaterThanOrEqual(layout.viewportWidth - 24);
    expect(layout.selectionHeader!.flexDirection).toBe("row-reverse");
  });

  test("search workspace returns a deterministic sample result", async ({ page }) => {
    await page.goto("/en/search");

    const searchInput = page.getByRole("combobox").first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill("praise");
    await expect(page.locator("#global-search-results")).toBeVisible();

    const praiseResult = page.locator(".search-result-item").first();
    await expect(praiseResult).toContainText(/praise/i);
    await praiseResult.click();

    await expect(page.locator(".selection-card")).toContainText("1:2");
    await expect(page.locator(".selection-card")).toContainText(/praise/i);
  });

  test("explore search preserves selection context across a visualization switch", async ({ page }) => {
    await page.goto("/en");

    const searchInput = page.locator('[data-tour-id="global-search-root"] input').first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill("praise");
    await expect(page.locator("#global-search-results")).toBeVisible();
    await page.locator(".search-result-item").first().click();

    const currentSelection = page.getByTestId("current-selection-panel");
    await expect(currentSelection).toBeVisible();

    const rootRow = page.getByTestId("selection-row-root");
    const surahRow = page.getByTestId("selection-row-surah");
    const rootRowText = (await rootRow.textContent()) ?? "";
    const surahRowText = (await surahRow.textContent()) ?? "";

    await expect(rootRow).not.toContainText("-");
    await expect(surahRow).toContainText("1.");

    await page.getByTestId("viz-switcher-trigger").click();
    await page.getByTestId("viz-option-root-network").click();

    await expect(page.getByTestId("selection-row-view")).toContainText(/root network/i);
    await expect(page.getByTestId("selection-row-root")).toHaveText(rootRowText);
    await expect(page.getByTestId("selection-row-surah")).toHaveText(surahRowText);
  });

  test("root network hides root-limit control for beginners and shows it for advanced users", async ({ page }) => {
    test.setTimeout(90000);
    await page.goto("/en");

    await page.getByTestId("viz-switcher-trigger").click();
    await page.getByTestId("viz-option-root-network").click();
    await waitForEither(
      page,
      page.getByRole("button", { name: /display settings/i }),
      page.getByText("Loading visualization...")
    );

    await expect(page.getByTestId("root-network-root-limit-control")).toHaveCount(0);

    await page.getByRole("button", { name: /display settings/i }).click();
    await page.getByTestId("display-experience-advanced").click();

    await expect(page.getByTestId("root-network-root-limit-control")).toBeVisible({ timeout: 60000 });
  });

  test("collocation beginner mode keeps only the target control and reveals advanced controls in advanced mode", async ({ page }) => {
    test.setTimeout(90000);
    await page.goto("/en");

    const searchInput = page.locator('[data-tour-id="global-search-root"] input').first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill("praise");
    await expect(page.locator("#global-search-results")).toBeVisible();
    await page.locator(".search-result-item").first().click();

    await page.getByTestId("viz-switcher-trigger").click();
    await page.getByRole("button", { name: /more visualizations/i }).click();
    await page.getByTestId("viz-option-collocation-network").click();

    await expect(page.getByTestId("collocation-target-control")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("collocation-target-input")).not.toHaveValue("");
    await expect(page.getByTestId("collocation-pair-control")).toHaveCount(0);
    await expect(page.getByTestId("collocation-group-filter-control")).toHaveCount(0);
    await expect(page.getByTestId("collocation-window-type-control")).toHaveCount(0);
    await expect(page.getByTestId("collocation-distance-control")).toHaveCount(0);
    await expect(page.getByTestId("collocation-min-frequency-control")).toHaveCount(0);
    await expect(page.getByTestId("collocation-pair-metrics")).toHaveCount(0);

    await page.getByRole("button", { name: /display settings/i }).click();
    await page.getByTestId("display-experience-advanced").click();

    await expect(page.getByTestId("collocation-pair-control")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("collocation-group-filter-control")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("collocation-window-type-control")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("collocation-min-frequency-control")).toBeVisible({ timeout: 60000 });
  });

  test("concordance rings side panels take clicks and keys", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop panels; the phone sheets are covered by the mobile flows");
    test.setTimeout(90000);
    await page.goto("/en?viz=concordance-rings");

    // The panels portal out of the rings' stage. As its React children, their
    // clicks reached the stage's pointer handlers, which captured the pointer
    // and ate the click; their keys reached its ring keys, which ate spaces.
    const chosen = page.locator(".cr-chosen .cr-root");
    await expect(chosen).toHaveText(["خلق", "سمو", "ارض"], { timeout: 60000 });

    await page.getByRole("button", { name: "Remove خلق" }).click();
    await expect(chosen).toHaveText(["سمو", "ارض"]);

    const input = page.locator(".cr-input");
    await input.click();
    await page.keyboard.type("ab c");
    await expect(input).toHaveValue("ab c");
    await input.fill("قمر");
    await page.locator(".cr-suggest button").first().click();
    await expect(chosen).toHaveText(["سمو", "ارض", "قمر"]);

    await page.locator(".cr-presets button").first().click();
    await expect(chosen).toHaveText(["خلق", "سمو", "ارض"]);

    // A row of the details panel's meeting list opens its ring's card.
    await page.locator(".drawer-edge-handle").click();
    await page.locator(".cr-meetings button").first().click();
    await expect(page.locator(".cr-drawer-head")).toBeVisible();
  });

  test("arc flow hides grouping controls for beginners and reveals them for advanced users", async ({ page }) => {
    test.setTimeout(90000);
    await page.goto("/en");

    await page.getByTestId("viz-switcher-trigger").click();
    await page.getByRole("button", { name: /more visualizations/i }).click();
    await page.getByTestId("viz-option-arc-flow").click();

    await expect(page.getByTestId("arc-flow-control-card")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("arc-flow-group-controls")).toHaveCount(0);
    await expect(page.getByTestId("arc-flow-root-search")).toHaveCount(0);

    await page.getByRole("button", { name: /display settings/i }).click();
    await page.getByTestId("display-experience-advanced").click();

    await expect(page.getByTestId("arc-flow-group-controls")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("arc-flow-root-search")).toBeVisible({ timeout: 60000 });
  });

  test("sankey flow hides root filtering for beginners and reveals it for advanced users", async ({ page }) => {
    test.setTimeout(90000);
    await page.goto("/en");

    await page.getByTestId("viz-switcher-trigger").click();
    await page.getByRole("button", { name: /more visualizations/i }).click();
    await page.getByTestId("viz-option-sankey-flow").click();

    await expect(page.getByTestId("sankey-control-card")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("sankey-root-filter")).toHaveCount(0);

    await page.getByRole("button", { name: /display settings/i }).click();
    await page.getByTestId("display-experience-advanced").click();

    await expect(page.getByTestId("sankey-root-filter")).toBeVisible({ timeout: 60000 });
  });

  test("explore explains context transforms when switching into syntax view", async ({ page }) => {
    await page.goto("/en");

    const searchInput = page.locator('[data-tour-id="global-search-root"] input').first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill("praise");
    await expect(page.locator("#global-search-results")).toBeVisible();
    await page.locator(".search-result-item").first().click();

    await page.getByTestId("viz-switcher-trigger").click();
    await page.getByRole("button", { name: /more visualizations/i }).click();
    await page.getByTestId("viz-option-dependency-tree").click();

    await expect(page.getByTestId("selection-row-view")).toContainText(/dependency/i);
    await expect(page.getByTestId("context-transform-message")).toContainText(/context adjusted for this view/i);
    await expect(page.getByTestId("context-transform-message")).toContainText(/root focus and lemma detail are hidden/i);
  });

  test("explore explains broader context reduction when switching into sankey view", async ({ page }) => {
    await page.goto("/en");

    const searchInput = page.locator('[data-tour-id="global-search-root"] input').first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill("praise");
    await expect(page.locator("#global-search-results")).toBeVisible();
    await page.locator(".search-result-item").first().click();

    await page.getByTestId("viz-switcher-trigger").click();
    await page.getByRole("button", { name: /more visualizations/i }).click();
    await page.getByTestId("viz-option-sankey-flow").click();

    await expect(page.getByTestId("selection-row-view")).toContainText(/sankey/i);
    await expect(page.getByTestId("context-transform-message")).toContainText(/ayah detail/i);
    await expect(page.getByTestId("context-transform-message")).toContainText(/root focus and lemma detail/i);
  });

  test("explore lets users dismiss the context-adjustment notice", async ({ page }) => {
    await page.goto("/en");

    const searchInput = page.locator('[data-tour-id="global-search-root"] input').first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill("praise");
    await expect(page.locator("#global-search-results")).toBeVisible();
    await page.locator(".search-result-item").first().click();

    await page.getByTestId("viz-switcher-trigger").click();
    await page.getByRole("button", { name: /more visualizations/i }).click();
    await page.getByTestId("viz-option-dependency-tree").click();

    const notice = page.getByTestId("context-transform-message");
    await expect(notice).toBeVisible();
    await page.getByTestId("context-transform-dismiss").click({ force: true });
    await expect(notice).toBeHidden();
  });

  test("explore can restore focused ayah context after a reducing view switch", async ({ page }) => {
    await page.goto("/en");

    const searchInput = page.locator('[data-tour-id="global-search-root"] input').first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill("praise");
    await expect(page.locator("#global-search-results")).toBeVisible();
    await page.locator(".search-result-item").first().click();

    await expect(page.getByTestId("selection-row-ayah")).not.toContainText("-");
    await expect(page.getByTestId("selection-row-token")).not.toContainText("-");

    await page.getByTestId("viz-switcher-trigger").click();
    await page.getByRole("button", { name: /more visualizations/i }).click();
    await page.getByTestId("viz-option-sankey-flow").click();

    const notice = page.getByTestId("context-transform-message");
    await expect(notice).toBeVisible();
    await expect(page.getByTestId("selection-row-ayah")).toContainText("-");
    await page.getByTestId("context-transform-recover").click({ force: true });

    await expect(page.getByTestId("selection-row-view")).toContainText(/radial sura/i);
    await expect(page.getByTestId("selection-row-ayah")).not.toContainText("-");
    await expect(page.getByTestId("selection-row-token")).not.toContainText("-");
  });

  test("authenticated explore flow can update tracked-root notes and learning state", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "qcv-dev-auth-user",
        JSON.stringify({
          id: "dev-user-5",
          aud: "authenticated",
          role: "authenticated",
          email: "reader5@example.com",
          email_confirmed_at: new Date().toISOString(),
          phone: "",
          confirmed_at: new Date().toISOString(),
          last_sign_in_at: new Date().toISOString(),
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_anonymous: false,
        })
      );
      window.localStorage.setItem(
        "qcv-dev-knowledge",
        JSON.stringify([])
      );
    });

    await page.goto("/en");

    const searchInput = page.locator('[data-tour-id="global-search-root"] input').first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill("praise");
    await expect(page.locator("#global-search-results")).toBeVisible();
    await page.locator(".search-result-item").first().click();

    await page.getByTestId("selection-track-toggle").click();
    await page.getByTestId("selection-notes-toggle").click();
    await page.getByTestId("selection-notes-input").fill("Revisit praise roots with morphology context");
    await page.getByTestId("selection-notes-save").click();

    await page.getByTestId("selection-track-toggle").click();

    const devKnowledge = await page.evaluate(() => window.localStorage.getItem("qcv-dev-knowledge"));
    expect(devKnowledge).not.toBeNull();
    expect(devKnowledge ?? "").toContain("Revisit praise roots with morphology context");
    expect(devKnowledge ?? "").toContain("\"state\":\"learned\"");
  });

  test("explore can clear inspector focus and restore context from sidebar search", async ({ page }) => {
    await page.goto("/en");

    const headerSearchInput = page.locator('[data-tour-id="global-search-root"] input').first();
    await expect(headerSearchInput).toBeVisible();

    await headerSearchInput.fill("praise");
    await expect(page.locator("#global-search-results")).toBeVisible();
    await page.locator(".search-result-item").first().click();

    await expect(page.getByTestId("selection-row-ayah")).not.toContainText("-");
    await expect(page.getByTestId("selection-row-token")).not.toContainText("-");

    await page.getByTestId("inspector-clear-focus").click();
    await expect(page.getByTestId("selection-row-ayah")).toContainText("-");
    await expect(page.getByTestId("selection-row-token")).toContainText("-");

    const sidebar = page.locator('[data-tour-id="tools-sidebar"]');
    const sidebarSearchInput = sidebar.locator("input").first();
    await sidebarSearchInput.fill("praise");
    await expect(sidebar.locator(".search-result-item").first()).toBeVisible();
    await sidebar.locator(".search-result-item").first().click();

    await expect(page.getByTestId("selection-row-ayah")).not.toContainText("-");
    await expect(page.getByTestId("selection-row-token")).not.toContainText("-");
  });

  test("explore can recover focused context from advanced search in the tools sidebar", async ({ page }) => {
    await page.goto("/en");

    const sidebar = page.locator('[data-tour-id="tools-sidebar"]');
    await sidebar.getByTestId("sidebar-tab-advanced-search").evaluate((node: HTMLButtonElement) => node.click());
    await expect(sidebar.getByTestId("sidebar-panel-advanced-search")).toBeVisible();

    await sidebar.getByTestId("semantic-search-ayah").fill("1:2");
    const semanticResult = sidebar.locator('[data-testid^="semantic-result-"]').first();
    await expect(semanticResult).toBeVisible();
    await semanticResult.evaluate((node: HTMLButtonElement) => node.click());

    await expect(page.getByTestId("selection-row-ayah")).toContainText("2");
    await expect(page.getByTestId("selection-row-token")).not.toContainText("-");
  });

  test("explore can change surah context from the corpus index in the tools sidebar", async ({ page }) => {
    await page.goto("/en");

    const sidebar = page.locator('[data-tour-id="tools-sidebar"]');
    await sidebar.getByTestId("sidebar-tab-index").evaluate((node: HTMLButtonElement) => node.click());
    await expect(sidebar.getByTestId("sidebar-panel-index")).toBeVisible();
    await sidebar.getByTestId("index-search-input").fill("2.");
    await sidebar.getByTestId("index-item-2").evaluate((node: HTMLButtonElement) => node.click());

    await expect(page.getByTestId("selection-row-surah")).toContainText("2.");
  });

  test("explore can establish root context from the corpus index in the tools sidebar", async ({ page }) => {
    await page.goto("/en");

    const sidebar = page.locator('[data-tour-id="tools-sidebar"]');
    await sidebar.getByTestId("sidebar-tab-index").evaluate((node: HTMLButtonElement) => node.click());
    await expect(sidebar.getByTestId("sidebar-panel-index")).toBeVisible();
    await sidebar.getByTestId("index-tab-root").evaluate((node: HTMLButtonElement) => node.click());

    const firstRoot = sidebar.locator(".index-item").first();
    await expect(firstRoot).toBeVisible();
    await firstRoot.evaluate((node: HTMLButtonElement) => node.click());

    await expect(page.getByTestId("selection-row-root")).not.toContainText("-");
  });

  test("explore can jump to a surah from inspector root distribution", async ({ page }) => {
    await page.goto("/en");

    const headerSearchInput = page.locator('[data-tour-id="global-search-root"] input').first();
    await expect(headerSearchInput).toBeVisible();
    await headerSearchInput.fill("praise");
    await expect(page.locator("#global-search-results")).toBeVisible();
    await page.locator(".search-result-item").first().click();

    const sidebar = page.locator('[data-tour-id="tools-sidebar"]');
    const rootSort = sidebar.getByTestId("inspector-root-sort");
    await expect(rootSort).toBeVisible();
    await rootSort.selectOption("order");
    await expect(sidebar.getByTestId("inspector-root-surah-1")).toBeVisible();
    await sidebar.getByTestId("inspector-root-surah-1").evaluate((node: HTMLButtonElement) => node.click());

    await expect(page.getByTestId("selection-row-surah")).toContainText("1.");
    await expect(page.getByTestId("selection-row-root")).not.toContainText("-");
  });

  test("explore preserves root context when inspector distribution is sorted by order", async ({ page }) => {
    await page.goto("/en");

    const headerSearchInput = page.locator('[data-tour-id="global-search-root"] input').first();
    await expect(headerSearchInput).toBeVisible();
    await headerSearchInput.fill("praise");
    await expect(page.locator("#global-search-results")).toBeVisible();
    await page.locator(".search-result-item").first().click();

    const sidebar = page.locator('[data-tour-id="tools-sidebar"]');
    const rootSort = sidebar.getByTestId("inspector-root-sort");
    await expect(rootSort).toBeVisible();
    await rootSort.selectOption("order");
    await expect(rootSort).toHaveValue("order");

    await expect(sidebar.getByTestId("inspector-root-surah-1")).toBeVisible();
    await sidebar.getByTestId("inspector-root-surah-1").evaluate((node: HTMLButtonElement) => node.click());

    await expect(page.getByTestId("selection-row-surah")).toContainText("1.");
    await expect(page.getByTestId("selection-row-root")).not.toContainText("-");
    await expect(page.getByTestId("selection-row-view")).toContainText(/radial sura/i);
  });
});

test.describe("auth and study access", () => {
  test("login page exposes auth entry points", async ({ page }) => {
    await page.goto("/en/auth/login");

    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /sign up/i })).toBeVisible();

    const forgotPasswordLink = page.getByRole("link", { name: /forgot password/i });
    await expect(forgotPasswordLink).toHaveAttribute("href", "/en/auth/reset-password");
    await page.goto("/en/auth/reset-password");
    await expect(page).toHaveURL(/\/en\/auth\/reset-password$/);
    await expect(page.getByRole("heading", { name: /reset password/i })).toBeVisible();
  });

  test("study redirects anonymous users to login", async ({ page }) => {
    await page.goto("/en/study");

    await expect(page).toHaveURL(/\/en\/auth\/login$/);
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  });

  test("study renders authenticated summary with seeded roots and resume state", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "qcv-dev-auth-user",
        JSON.stringify({
          id: "dev-user-1",
          aud: "authenticated",
          role: "authenticated",
          email: "reader@example.com",
          email_confirmed_at: new Date().toISOString(),
          phone: "",
          confirmed_at: new Date().toISOString(),
          last_sign_in_at: new Date().toISOString(),
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_anonymous: false,
        })
      );
      window.localStorage.setItem(
        "qcv-dev-knowledge",
        JSON.stringify([
          { root: "حمد", state: "learning", notes: "Track praise roots", updatedAt: Date.now() },
          { root: "رحم", state: "learned", notes: "Mercy cluster", updatedAt: Date.now() },
        ])
      );
      window.localStorage.setItem(
        "quran-corpus-recent-exploration",
        JSON.stringify({
          lastVisualizationMode: "root-network",
          lastSurahId: 1,
          lastRoot: "حمد",
          lastLemma: "حَمْد",
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await page.goto("/en/study");

    await expect(page.getByRole("heading", { name: "Study", exact: true })).toBeVisible();
    await expect(page.locator("text=reader@example.com")).toBeVisible();
    await expect(page.locator("text=Resume exploration")).toBeVisible();
    await expect(page.locator("text=root-network")).toBeVisible();
    await expect(page.locator("text=Tracked roots: 2")).toBeVisible();
    await expect(page.locator("text=Recent roots:")).toContainText(/حمد|رحم/);
  });

  test("study supports resume and sign-out actions for seeded auth", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "qcv-dev-auth-user",
        JSON.stringify({
          id: "dev-user-2",
          aud: "authenticated",
          role: "authenticated",
          email: "reader2@example.com",
          email_confirmed_at: new Date().toISOString(),
          phone: "",
          confirmed_at: new Date().toISOString(),
          last_sign_in_at: new Date().toISOString(),
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_anonymous: false,
        })
      );
      window.localStorage.setItem(
        "qcv-dev-knowledge",
        JSON.stringify([{ root: "???", state: "learning", notes: "", updatedAt: Date.now() }])
      );
      window.localStorage.setItem(
        "quran-corpus-recent-exploration",
        JSON.stringify({
          lastVisualizationMode: "root-network",
          lastSurahId: 1,
          lastRoot: "???",
          updatedAt: new Date().toISOString(),
        })
      );
    });

    await page.goto("/en/study");
    await page.getByTestId("study-resume-explore").click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByTestId("app-mode-link-explore")).toHaveAttribute("data-active", "true");

    await page.goto("/en/study");
    await page.getByTestId("study-sign-out").click();
    await expect(page).toHaveURL(/\/en$/);

    const authUser = await page.evaluate(() => window.localStorage.getItem("qcv-dev-auth-user"));
    expect(authUser).toBeNull();
  });

  test("study can edit tracked-root notes and update learning state", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "qcv-dev-auth-user",
        JSON.stringify({
          id: "dev-user-6",
          aud: "authenticated",
          role: "authenticated",
          email: "reader6@example.com",
          email_confirmed_at: new Date().toISOString(),
          phone: "",
          confirmed_at: new Date().toISOString(),
          last_sign_in_at: new Date().toISOString(),
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_anonymous: false,
        })
      );
      window.localStorage.setItem(
        "qcv-dev-knowledge",
        JSON.stringify([
          {
            root: "حمد",
            state: "learning",
            notes: "Initial note",
            addedAt: Date.now(),
            lastReviewedAt: Date.now(),
          },
        ])
      );
    });

    await page.goto("/en/study");

    await page.getByTestId("study-root-edit-حمد").click();
    await page.getByTestId("study-root-notes-input-حمد").fill("Updated study note for praise root");
    await page.getByTestId("study-root-save-حمد").click();
    await expect(page.locator("text=Updated study note for praise root")).toBeVisible();

    await page.getByTestId("study-root-toggle-حمد").click();
    await expect(page.getByTestId("study-root-state-حمد")).toContainText(/learned/i);

    const devKnowledge = await page.evaluate(() => window.localStorage.getItem("qcv-dev-knowledge"));
    expect(devKnowledge).not.toBeNull();
    expect(devKnowledge ?? "").toContain("Updated study note for praise root");
    expect(devKnowledge ?? "").toContain("\"state\":\"learned\"");
  });

});

test.describe("mobile shell flows", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "quran-corpus-onboarding",
        JSON.stringify({
          version: "2",
          showOnStartup: false,
          completed: true,
        })
      );
    });
  });

  test("mobile search overlay selects a result and selection can be inspected", async ({ page }) => {
    await page.goto("/en");

    await expect(page.getByTestId("mobile-viz-bar")).toBeVisible();

    await page.getByTestId("topbar-mobile-search-trigger").click();
    await expect(page.getByTestId("mobile-search-overlay")).toBeVisible();

    const searchInput = page.getByTestId("mobile-search-overlay").getByRole("combobox");
    await searchInput.fill("praise");
    await expect(page.locator("#global-search-results")).toBeVisible();
    await page.locator(".search-result-item").first().click();

    await expect(page.getByTestId("mobile-search-overlay")).toBeHidden();
    await page.getByTestId("mobile-viz-bar-tools").click({ force: true });
    await expect(page.locator('[data-tour-id="app-sidebar"]')).toBeVisible();

    const recentExploration = await page.evaluate(() => {
      const raw = window.localStorage.getItem("quran-corpus-recent-exploration");
      return raw ? JSON.parse(raw) : null;
    });

    expect(recentExploration).not.toBeNull();
    expect(recentExploration.lastSurahId).toBe(1);
    expect(recentExploration.lastRoot || recentExploration.lastLemma).toBeTruthy();
  });

  test("mobile surfaces stay mutually exclusive", async ({ page }) => {
    await page.goto("/en");

    await expect(page.getByTestId("mobile-viz-bar")).toBeVisible();

    await page.getByTestId("topbar-mobile-search-trigger").click();
    await expect(page.getByTestId("mobile-search-overlay")).toBeVisible();

    await page.getByTestId("mobile-viz-bar-tools").click({ force: true });
    await expect(page.getByTestId("mobile-search-overlay")).toBeHidden();
    await expect(page.locator('[data-tour-id="app-sidebar"]')).toBeVisible();

    await page.getByTestId("mobile-nav-menu-trigger").click();
    await expect(page.getByTestId("mobile-nav-menu-dropdown")).toBeVisible();
    await expect(page.locator('[data-tour-id="tools-sidebar"]')).not.toHaveClass(/open/);
  });
});

test.describe("degraded states", () => {
  test("search workspace surfaces search recovery guidance deterministically", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("qcv-dev-search-status", "unavailable");
    });

    await page.goto("/en/search");

    await expect(page.getByTestId("search-workspace-search-message")).toContainText(/search is temporarily limited/i);
    await expect(page.getByRole("heading", { name: /find roots, ayahs, lemmas, and glosses faster/i })).toBeVisible();
  });

  test("search workspace surfaces loading corpus guidance deterministically", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("qcv-dev-corpus-status", "loading");
    });

    await page.goto("/en/search");

    await expect(page.locator(".ui-pill")).toContainText(/shell ready/i);
    // Loading takes priority over the shell-ready note in the single collapsed
    // status pill — only one status line renders at a time (see SearchWorkspace's
    // primaryStatusMessage).
    await expect(page.getByTestId("search-workspace-status-message")).toContainText(/loading the full corpus/i);
  });

  test("search workspace surfaces fallback corpus status deterministically", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "qcv-dev-corpus-status",
        "fallback"
      );
    });

    await page.goto("/en/search");

    await expect(page.locator(".ui-pill")).toContainText(/fallback/i);
    await expect(page.getByTestId("search-workspace-status-message")).toContainText(/using fallback corpus data/i);
    await expect(page.getByRole("heading", { name: /find roots, ayahs, lemmas, and glosses faster/i })).toBeVisible();
  });

  test("explore shell surfaces fallback recovery guidance deterministically", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "quran-corpus-onboarding",
        JSON.stringify({
          version: "2",
          showOnStartup: false,
          completed: true,
        })
      );
      window.localStorage.setItem("qcv-dev-corpus-status", "fallback");
    });

    await page.goto("/en");

    await expect(page.getByTestId("explore-data-recovery-message")).toContainText(/using fallback corpus data/i);
    await expect(page.locator('[data-tour-id="main-viewport"]')).toBeVisible();
    await expect(page.locator(".ui-overlay-pill")).toContainText(/full corpus unavailable/i);
  });

  test("explore shell surfaces loading recovery guidance deterministically", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "quran-corpus-onboarding",
        JSON.stringify({
          version: "2",
          showOnStartup: false,
          completed: true,
        })
      );
      window.localStorage.setItem("qcv-dev-corpus-status", "loading");
    });

    await page.goto("/en");

    await expect(page.getByTestId("explore-loading-indicator")).toContainText(/preparing the full corpus/i);
    await expect(page.getByTestId("explore-data-recovery-message")).toContainText(/loading the full corpus/i);
    await expect(page.locator(".ui-overlay-pill")).toContainText(/loading full corpus/i);
  });

  test("explore shell surfaces search recovery guidance deterministically", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "quran-corpus-onboarding",
        JSON.stringify({
          version: "2",
          showOnStartup: false,
          completed: true,
        })
      );
      window.localStorage.setItem("qcv-dev-search-status", "unavailable");
    });

    await page.goto("/en");

    await expect(page.getByTestId("explore-search-recovery-message")).toContainText(/search is temporarily limited/i);
    await expect(page.locator('[data-tour-id="main-viewport"]')).toBeVisible();
  });
});

test.describe("study migration flows", () => {
  test("study can decline a pending local migration in dev mode", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "qcv-dev-auth-user",
        JSON.stringify({
          id: "dev-user-3",
          aud: "authenticated",
          role: "authenticated",
          email: "reader3@example.com",
          email_confirmed_at: new Date().toISOString(),
          phone: "",
          confirmed_at: new Date().toISOString(),
          last_sign_in_at: new Date().toISOString(),
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_anonymous: false,
        })
      );
      window.localStorage.setItem(
        "qcv-dev-pending-migration",
        JSON.stringify([
          { root: "حمد", state: "learning", notes: "Unsynced local root", updatedAt: Date.now() },
        ])
      );
    });

    await page.goto("/en/study");

    await expect(page.locator("text=Sync local study data")).toBeVisible();
    await page.getByTestId("study-migration-decline").click();
    await expect(page.locator("text=Sync local study data")).toHaveCount(0);

    const pendingMigration = await page.evaluate(() => window.localStorage.getItem("qcv-dev-pending-migration"));
    expect(pendingMigration).toBeNull();
  });

  test("study can merge pending local data and run import-export actions in dev mode", async ({ page }) => {
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await page.addInitScript(() => {
      window.localStorage.setItem(
        "qcv-dev-auth-user",
        JSON.stringify({
          id: "dev-user-4",
          aud: "authenticated",
          role: "authenticated",
          email: "reader4@example.com",
          email_confirmed_at: new Date().toISOString(),
          phone: "",
          confirmed_at: new Date().toISOString(),
          last_sign_in_at: new Date().toISOString(),
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_anonymous: false,
        })
      );
      window.localStorage.setItem(
        "qcv-dev-knowledge",
        JSON.stringify([
          { root: "رحم", state: "learned", notes: "Existing tracked root", updatedAt: Date.now() },
        ])
      );
      window.localStorage.setItem(
        "qcv-dev-pending-migration",
        JSON.stringify([
          { root: "حمد", state: "learning", notes: "Unsynced local root", updatedAt: Date.now() },
        ])
      );
    });

    await page.goto("/en/study");

    await expect(page.locator("text=Sync local study data")).toBeVisible();
    await page.getByTestId("study-migration-merge").click();
    await expect(page.locator("text=Sync local study data")).toHaveCount(0);
    await expect(page.locator("text=Tracked roots: 2")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("study-export-data").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^quran-knowledge-\d{4}-\d{2}-\d{2}\.json$/);

    const importPayload = {
      version: 1,
      exportedAt: Date.now(),
      roots: [
        { root: "نور", state: "learning", notes: "Imported root", updatedAt: Date.now() },
      ],
    };

    await page.setInputFiles("[data-testid='study-import-input']", {
      name: "knowledge-import.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(importPayload), "utf8"),
    });

    await expect(page.locator("text=Tracked roots: 3")).toBeVisible();
    await expect(page.locator("text=Recent roots:")).toContainText(/رحم|حمد|نور/);

    const devKnowledge = await page.evaluate(() => window.localStorage.getItem("qcv-dev-knowledge"));
    expect(devKnowledge).not.toBeNull();
    expect(devKnowledge ?? "").toContain("نور");
  });
});
