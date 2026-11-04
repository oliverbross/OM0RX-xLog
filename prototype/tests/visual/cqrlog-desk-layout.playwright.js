// Run with browser_run_code_unsafe(filename: <absolute path>).
// Uses actual components in the inert fixture; never invokes station output.
async (page) => {
  const out = "/Users/oliver/Documents/Projects/OM0RX-xLog/.build/cqrlog-desk-layout-20261105";
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  const assert = (condition, label, value) => { if (!condition) throw Error(`${label}: ${JSON.stringify(value)}`); };
  const measure = () => page.evaluate(() => {
    const card = document.querySelector(".desk-active"), rect = card.getBoundingClientRect();
    return { card: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, clientHeight: card.clientHeight,
      scrollHeight: card.scrollHeight, scrollTop: card.scrollTop, clientWidth: card.clientWidth,
      scrollWidth: card.scrollWidth, overflowY: getComputedStyle(card).overflowY },
      formHeight: card.querySelector("form").getBoundingClientRect().height,
      draft: window.__deskFixture.draft, actions: [...window.__deskFixture.actions], outerScroll: scrollY };
  });
  const visible = selector => page.locator(selector).first().evaluate(element => {
    const rect = element.getBoundingClientRect(), card = element.closest(".desk-active").getBoundingClientRect();
    return rect.top >= card.top + 1 && rect.bottom <= card.bottom - 1 && rect.left >= card.left && rect.right <= card.right;
  });
  const rows = [];
  for (const [width, height] of [[1920,1080],[1360,900],[760,900],[420,900]]) {
    const label = `${width}x${height}`;
    await page.setViewportSize({ width, height });
    await page.goto("http://127.0.0.1:1421/tests/visual/cqrlog-desk-preview.html");
    await page.waitForFunction(() => document.querySelector(".voice-folder input")?.value === "/isolated-fixture/voice");
    const closed = await measure();
    await page.locator(".cw-composition > summary").click();
    await page.locator(".voice-desk > details > summary").click();
    await page.locator(".voice-settings > summary").click();
    const expanded = await measure();
    assert(expanded.card.overflowY === "auto", "vertical scroll contract", expanded);
    assert(expanded.card.height === closed.card.height, "outer card height changed", {closed,expanded});
    assert(expanded.formHeight >= closed.formHeight - 1, "QSO form shrank", {closed,expanded});
    assert(expanded.card.scrollWidth <= expanded.card.clientWidth + 1, "horizontal overflow", expanded);
    const card = expanded.card;
    await page.mouse.move(card.x + card.width / 2, card.y + Math.min(card.height / 2, 200));
    await page.mouse.wheel(0, -10000);
    await page.waitForFunction(() => document.querySelector(".desk-active").scrollTop === 0);
    const top = await measure();
    assert(await visible('[aria-label="Desk Callsign"]'), "callsign inaccessible", top);
    await page.screenshot({path:`${out}/${label}-top.png`});
    await page.mouse.wheel(0, 10000);
    await page.waitForFunction(() => { const c=document.querySelector(".desk-active"); return Math.abs(c.scrollHeight-c.clientHeight-c.scrollTop)<2; });
    const bottom = await measure();
    assert(bottom.card.scrollTop > 100 && Math.abs(bottom.outerScroll - top.outerScroll) < 2, "wheel moved outer page", {top,bottom});
    assert(await visible(".voice-import input"), "bottom voice controls inaccessible", bottom);
    await page.screenshot({path:`${out}/${label}-voice-bottom.png`});
    await page.locator(".desk-log").scrollIntoViewIfNeeded();
    assert(await visible(".desk-log"), "QSO footer inaccessible", await measure());
    await page.screenshot({path:`${out}/${label}-qso-footer.png`});
    await page.locator(".cw-compose-actions").scrollIntoViewIfNeeded();
    assert(await visible(".cw-compose-actions"), "CW Send/Stop inaccessible", await measure());
    await page.screenshot({path:`${out}/${label}-cw-actions.png`});
    await page.locator(".voice-edit-fields input").first().focus();
    assert(await visible(".voice-edit-fields input"), "focused field clipped", await measure());
    await page.locator(".voice-settings > summary").click();
    await page.locator(".voice-desk > details > summary").click();
    await page.locator(".cw-composition > summary").click();
    const after = await measure();
    assert(after.card.height === closed.card.height && after.card.scrollHeight === closed.card.scrollHeight, "closed geometry changed", {closed,after});
    assert(JSON.stringify(after.draft) === JSON.stringify(closed.draft), "draft mutated", {closed,after});
    assert(after.actions.length === 0, "action dispatched", after.actions);
    // Collapsing a lower summary preserves normal browser focus/scroll. Return
    // with a real pointer wheel; the product intentionally adds no auto-scroll.
    await page.mouse.move(card.x + card.width / 2, card.y + Math.min(card.height / 2, 200));
    await page.mouse.wheel(0, -10000);
    await page.waitForFunction(() => document.querySelector(".desk-active").scrollTop === 0);
    const closedTop = await measure();
    assert(await visible('[aria-label="Desk Callsign"]'), "closed callsign inaccessible", closedTop);
    if (width >= 1000) assert(await visible(".desk-log"), "closed desktop footer needs scrolling", closedTop);
    await page.screenshot({path:`${out}/${label}-closed-again.png`});
    await page.locator(".cw-composition > summary").click();
    await page.getByRole("button", {name:"Stop CW",exact:true}).click();
    await page.locator(".cw-composition > summary").click();
    await page.locator(".voice-desk > details > summary").click();
    await page.getByRole("button", {name:"Stop voice",exact:true}).click();
    await page.locator(".voice-desk > details > summary").click();
    const stops = await measure();
    assert(JSON.stringify(stops.actions) === JSON.stringify(["cw-stop","voice-stop"]), "Stop handler inaccessible/duplicated", stops.actions);
    assert(JSON.stringify(stops.draft) === JSON.stringify(closed.draft), "Stop changed draft", stops);
    rows.push({ viewport:label, closed, expanded, wheelTop:top, wheelBottom:bottom, closedAgain:after, closedAtTop:closedTop,
      stopEvidence:stops.actions,
      result:"PASS: fixed height; intact form; pointer wheel stays in card; no horizontal overflow; callsign/footer/CW actions/bottom voice accessible; focus scroll; closed geometry/draft/actions preserved; both Stop handlers once" });
  }
  assert(errors.length === 0, "browser page errors", errors);
  return {rows,summary:rows.map(row=>({viewport:row.viewport,height:row.closed.card.height,expandedScrollHeight:row.expanded.card.scrollHeight,bottomScroll:row.wheelBottom.card.scrollTop,result:row.result}))};
}
