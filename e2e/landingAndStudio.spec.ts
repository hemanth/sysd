import { test, expect } from 'playwright/test';

test.describe('sysd Drafting Sheet, Free-Flow, Reference Solutions & Opaque Runtime E2E', () => {
  let pageErrors: string[] = [];
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    consoleErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('Swiss architectural drafting sheet renders at root URL with blueprint schematic & 00-11 ledger', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveTitle(/sysd/i);
    await expect(page.locator('.sysd-landing')).toBeVisible();
    await expect(page.locator('.sysd-wordmark')).toHaveText('sysd');

    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('Sketch the topology.');
    await expect(heading).toContainText('Defend the trade-offs.');

    await expect(page.locator('#start-practice-btn')).toBeVisible();
    await expect(page.locator('#start-freeflow-btn')).toBeVisible();
    await expect(page.locator('.sysd-blueprint-svg')).toBeVisible();

    // 1 Free-Flow row (00) + 11 Canonical Archetypes (01-11) = 12 rows
    await expect(page.locator('.sysd-ledger-row')).toHaveCount(12);
    await expect(page.getByText('Free-Flow Architecture Canvas')).toBeVisible();
    await expect(page.getByText('High-Demand Seat Ticketing')).toBeVisible();

    // Studio canvas is not mounted on landing
    await expect(page.locator('.studio-shell')).toHaveCount(0);
  });

  test('Start Timed Mock opens studio canvas and sysd brand mark returns to landing sheet', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.locator('#start-practice-btn').click();
    await expect(page.locator('.studio-shell')).toBeVisible();
    await expect(page.locator('.excalidraw-host')).toBeVisible();
    expect(page.url()).toContain('#studio');

    await page.locator('#starter-flow-btn').click();
    await expect(page.locator('.topology-badge')).toContainText('3 nodes');

    // Return home via sysd brand mark
    await page.locator('.topbar-left .brand-mark').click();
    await expect(page.locator('.sysd-landing')).toBeVisible();
    await expect(page.locator('.studio-shell')).toHaveCount(0);
  });

  test('Free-Flow practice mode launches with custom topic and open-ended coaching', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.locator('#start-freeflow-btn').click();
    const landingTopicInput = page.locator('.sysd-freeflow-input');
    await expect(landingTopicInput).toBeVisible();
    await landingTopicInput.fill('Stripe Webhook Delivery Engine');
    await landingTopicInput.press('Enter');

    await expect(page.locator('.studio-shell')).toBeVisible();
    const studioTopicInput = page.locator('#freeflow-topic-input');
    await expect(studioTopicInput).toBeVisible();
    await expect(studioTopicInput).toHaveValue('Stripe Webhook Delivery Engine');
    await expect(page.locator('#challenge-picker')).toContainText('Free-Flow Architecture');
    await expect(page.locator('#challenge-picker')).toContainText('OPEN · FREE-FLOW');
  });

  test('Reference solution tab inspects Staff blueprint and stamps full topology onto Excalidraw', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const cloudSyncRow = page.locator('.sysd-ledger-row', {
      hasText: 'Chunked Cloud File Sync',
    });
    await cloudSyncRow.click();

    await expect(page.locator('.studio-shell')).toBeVisible();
    await expect(page.locator('#challenge-picker')).toContainText('Chunked Cloud File Sync');

    const solutionTab = page.locator('button[data-tab="solution"]');
    await expect(solutionTab).toBeVisible();
    await solutionTab.click();

    await expect(page.getByText('Capacity & Sizing Math')).toBeVisible();
    await expect(page.getByText('Schema, Keys & Invariants')).toBeVisible();
    await expect(page.getByText('Write Path Lifecycle')).toBeVisible();
    await expect(page.getByText('Staff+ Failure & Scale Defenses')).toBeVisible();

    await page.locator('#stamp-solution-btn').click();
    await expect(page.locator('.topology-badge')).toContainText('9 nodes');
    await expect(page.locator('.topology-badge')).toContainText('10 edges');
  });

  test('Opaque background model preloading runs with zero manual model pickers or console errors', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    await expect(page.locator('#runtime-trigger')).toHaveCount(0);
    await expect(page.locator('.model-menu-wrap')).toHaveCount(0);
    await expect(page.locator('.model-popover')).toHaveCount(0);
    await expect(page.locator('#enable-needle-btn')).toHaveCount(0);

    await page.locator('#start-practice-btn').click();
    await expect(page.locator('.studio-shell')).toBeVisible();

    await expect(page.locator('#runtime-trigger')).toHaveCount(0);
    await expect(page.locator('.model-menu-wrap')).toHaveCount(0);
    await expect(page.locator('.model-popover')).toHaveCount(0);
    await expect(page.locator('#enable-needle-btn')).toHaveCount(0);
  });
});
