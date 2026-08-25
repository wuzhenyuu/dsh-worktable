/* Final-product acceptance probe for Task 7.
 *
 * The final client bundle is served by a disposable loopback HTTP fixture and
 * loaded by a real headless Chrome.  The production WorktableSection is
 * executed with a small host-React adapter so its real localStorage-backed
 * WorktableSection effect/bridge harness is installed before the browser-domain checks run.
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const {
  requireLocalDependency,
  resolveRepositoryRoot,
  resolveChromePath,
  createDisposableProfile,
  assertDisposablePath,
  removeDisposableProfile,
  stopChild,
  stopChildTree,
} = require('./test-harness.cjs')

const repo = resolveRepositoryRoot()
const finalBundle = path.join(repo, '01_content', 'lib', 'client.js')
const WebSocket = requireLocalDependency('ws')

function fixtureHtml() {
  return [
    '<!doctype html>',
    '<html><body>',
    '<main id="root" style="width:1200px;height:800px"><div data-phase="active" style="width:1200px;height:800px"><div style="height:32px"></div><div style="height:768px"></div></div></main>',
    '<script>',
    'if (!localStorage.getItem("__dsh_acceptance_browser_v2")) {',
    '  localStorage.clear();',
    '  localStorage.setItem("__dsh_acceptance_browser_v2", "1");',
    '  localStorage.setItem("dsh.worktable.updateCheck.v1", "0");',
    '  localStorage.setItem("dsh.worktable.projects.v1", JSON.stringify({',
    '    order: ["shared-master", "rule-project", "project-a", "project-b"],',
    '    lastUsed: {}, hidden: [], nameOverrides: { "shared-master": "Shared master" },',
    '    iconOverrides: {}, removed: [], views: {}, shortcuts: [],',
    '    layouts: [',
    '      { id: "shared-master", title: "Shared master", icon: "M", main: [] },',
    '      { id: "rule-project", title: "Rule project", icon: "R", main: [] },',
    '      { id: "project-a", title: "Project A", icon: "A", main: [] },',
    '      { id: "project-b", title: "Project B", icon: "B", main: [] }',
    '    ], bindings: {}, folders: {}',
    '  }));',
    '  localStorage.setItem("dsh.worktable.controlRooms.v1", JSON.stringify({ version: 1, order: [], activeId: null, rooms: {} }));',
    '  localStorage.setItem("dsh.worktable.controlRooms.trash.v1", JSON.stringify({ version: 1, deleted: [], audit: [] }));',
    '  localStorage.setItem("dsh.worktable.split.v2", JSON.stringify({',
    '    "wt-console:room-1": { chatW: 411, topH: 207, leftW: 263, paneWs: [], topWs: [], leftWs: [] },',
    '    "wt-console:room-2": { chatW: 577, topH: 209, leftW: 269, paneWs: [], topWs: [], leftWs: [] }',
    '  }));',
    '}',
    'window.__ModuleLoader__ = { load: function(spec) { window.__dshLoadedSpec = spec; } };',
    'window.matchMedia = window.matchMedia || function() { return { matches: false, addListener: function(){}, removeListener: function(){}, addEventListener: function(){}, removeEventListener: function(){} }; };',
    'window.requestAnimationFrame = window.requestAnimationFrame || function(fn) { return setTimeout(fn, 0); };',
    'window.cancelAnimationFrame = window.cancelAnimationFrame || function(id) { clearTimeout(id); };',
    'window.open = window.open || function() { return null; };',
    'window.prompt = window.prompt || function() { return null; };',
    'window.URL.createObjectURL = window.URL.createObjectURL || function() { return "blob:acceptance"; };',
    'window.URL.revokeObjectURL = window.URL.revokeObjectURL || function() {};',
    'window.ResizeObserver = window.ResizeObserver || function() { this.observe = function() {}; this.disconnect = function() {}; };',
    'window.MutationObserver = window.MutationObserver || function() { this.observe = function() {}; this.disconnect = function() {}; };',
    '</script>',
    '<script src="/bundle.js"></script>',
    '<script>',
    'window.__dshAcceptanceMount = function() {',
    '  var effects = []; var state = []; var refs = []; var cursor = 0; var rendering = false; var runningEffects = false; var rendered = null; var renderCount = 0; var dirty = false;',
    '  function render() { renderCount += 1; if (renderCount > 100) throw new Error("acceptance host adapter render loop"); dirty = false; cursor = 0; effects = []; rendering = true; rendered = component({ wide: true, t: function(key) { return key; }, renderSlot: function() { return null; }, sessionBridge: { sessions: { open: function() {} } } }); rendering = false; var pending = effects.slice(); if (!runningEffects) { runningEffects = true; for (var effectIndex = 0; effectIndex < pending.length; effectIndex += 1) { try { pending[effectIndex](); } catch (error) { errors.push(String(error && error.stack || error)); } } runningEffects = false; } return rendered; }',
    '  function useState(initial) { var index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], function(next) { state[index] = typeof next === "function" ? next(state[index]) : next; if (!rendering && !runningEffects) dirty = true; }]; }',
    '  function useRef(initial) { var index = cursor++; if (!(index in refs)) refs[index] = { current: initial }; return refs[index]; }',
    '  function useMemo(fn) { cursor++; return fn(); }',
    '  function useCallback(fn) { cursor++; return fn; }',
    '  function useEffect(fn) { cursor++; effects.push(fn); }',
    '  function useLayoutEffect(fn) { cursor++; effects.push(fn); }',
    '  var react = { useState: useState, useRef: useRef, useMemo: useMemo, useCallback: useCallback, useEffect: useEffect, useLayoutEffect: useLayoutEffect, Fragment: "fragment", createElement: function(type, props) { return { type: type, props: props }; } };',
    '  var jsx = function(type, props) { return { type: type, props: props }; };',
    '  var fakeRequire = function(name) {',
    '    if (name === "react") return react;',
    '    if (name === "react/jsx-runtime" || name === "react/jsx-dev-runtime") return { jsx: jsx, jsxs: jsx, Fragment: "fragment" };',
    '    throw new Error("unexpected external dependency: " + name);',
    '  };',
    '  var errors = []; var component = null;',
    '  try {',
    '    var moduleExports = window.__dshLoadedSpec.factory(fakeRequire);',
    '    window.__dshAcceptanceSessionOpenTrace = [];',
    '    moduleExports.apply({ effect: function(fn) { return fn(); }, locale: { register: function() {}, bind: function() { return function(key) { return key; }; } }, slots: { entries: function() { return []; }, subscribe: function() { return function() {}; }, inject: function() {} }, sessions: { list: { getSnapshot: function() { var byId = {}; for (var sessionIndex = 0; sessionIndex < 5; sessionIndex += 1) byId["session-" + sessionIndex] = { id: "session-" + sessionIndex, title: "Session " + sessionIndex }; return { ids: Object.keys(byId), byId: byId }; }, subscribe: function() { return function() {}; } }, open: function(sessionId) { window.__dshAcceptanceSessionOpenTrace.push(sessionId); } }, conversation: {}, workspaces: {} });',
    '    component = moduleExports.WorktableSection;',
    '    rendered = render();',
    '    window.__dshAcceptanceFlush = function() { if (dirty) render(); };',
    '    window.__dshAcceptanceOpenTrace = [];',
    '    var originalSplitOpen = window.__dshWorktable.splitStore.open;',
    '    window.__dshWorktable.splitStore.open = function(spec) { var value = originalSplitOpen.call(this, spec); window.__dshAcceptanceOpenTrace.push({ id: spec && spec.id, value: value, active: this.active, chatW: this.chatW, spec: this.spec }); return value; };',
    '  } catch (error) { errors.push(String(error && error.stack || error)); }',
    '  var bridge = window.__dshWorktable && window.__dshWorktable.controlRooms;',
    '  return { ok: errors.length === 0, moduleId: window.__dshLoadedSpec && window.__dshLoadedSpec.id, hasWorktableSection: !!(window.__dshLoadedSpec && typeof window.__dshLoadedSpec.factory(fakeRequire).WorktableSection === "function"), bridgeInstalled: !!bridge, effectErrors: errors, rendered: !!rendered, realBrowser: window.localStorage instanceof Storage && window.document instanceof Document };',
    '};',
    'window.__dshAcceptanceRun = function() {',
    '  var bridge = window.__dshWorktable && window.__dshWorktable.controlRooms;',
    '  var checks = []; var failures = [];',
    '  function ok(value, label) { checks.push(label); if (!value) failures.push(label); }',
    '  function execute(request) { var result = bridge.execute(request); ok(!!result && typeof result.ok === "boolean", "bridge returns typed result for " + request.action); return result; }',
    '  function rooms() { return execute({ action: "control_room.list" }).data.rooms; }',
    '  function room(id) { return rooms().find(function(item) { return item.id === id; }); }',
    '  function activeId() { return execute({ action: "control_room.list" }).data.activeId; }',
    '  ok(!!bridge && typeof bridge.execute === "function", "production control-room bridge exposes execute");',
    '  var projectBefore = localStorage.getItem("dsh.worktable.projects.v1");',
    '  var sharedBefore = JSON.stringify(JSON.parse(projectBefore).layouts.find(function(item) { return item.id === "shared-master"; }));',
    '  var created = [];',
    '  for (var i = 0; i < 10; i += 1) {',
    '    var createdResult = execute({ action: "control_room.create", controlRoomId: "room-" + i, room: { name: "Room " + i, description: "Acceptance room " + i, boundSessionId: i < 5 ? "session-" + i : null } });',
    '    ok(createdResult.ok, "creates room " + i); created.push(createdResult.data);',
    '  }',
    '  var listed = rooms();',
    '  ok(listed.length === 10, "ten rooms are persisted in browser localStorage");',
    '  ok(new Set(listed.map(function(item) { return item.id; })).size === 10, "room identifiers are unique");',
    '  ok(listed.filter(function(item) { return item.boundSessionId; }).length === 5, "five distinct session bindings are retained");',
    '  ok(listed.every(function(item) { return item.layoutId === "wt-console:" + item.id; }), "each room owns an independent layout identifier");',
    '  ["room-0", "room-1", "room-2"].forEach(function(id) { ok(execute({ action: "control_room.add_projects", controlRoomId: id, projectIds: ["shared-master"] }).ok, "adds shared master reference to " + id); });',
    '  ok(room("room-0").projectIds.indexOf("shared-master") >= 0 && room("room-1").projectIds.indexOf("shared-master") >= 0 && room("room-2").projectIds.indexOf("shared-master") >= 0, "one master project is referenced by three rooms");',
    '  ok(execute({ action: "control_room.add_projects", controlRoomId: "room-1", projectIds: ["project-a", "project-b"] }).ok, "adds two projects to room one");',
    '  ok(execute({ action: "control_room.add_projects", controlRoomId: "room-2", projectIds: ["project-a", "project-b"] }).ok, "adds two projects to room two");',
    '  ok(execute({ action: "control_room.reorder_projects", controlRoomId: "room-1", projectIds: ["project-b", "project-a", "shared-master"] }).ok, "reorders room one independently");',
    '  ok(execute({ action: "control_room.reorder_projects", controlRoomId: "room-2", projectIds: ["project-a", "project-b", "shared-master"] }).ok, "reorders room two independently");',
    '  var orderOne = room("room-1").projectOrder.slice(); var orderTwo = room("room-2").projectOrder.slice();',
    '  ok(JSON.stringify(orderOne) !== JSON.stringify(orderTwo), "different rooms retain different actual project order");',
    '  ok(JSON.parse(localStorage.getItem("dsh.worktable.controlRooms.v1")).rooms["room-1"].projectOrder[0] === "project-b", "room one order is persisted");',
    '  ok(JSON.parse(localStorage.getItem("dsh.worktable.controlRooms.v1")).rooms["room-2"].projectOrder[0] === "project-a", "room two order is persisted independently");',
    '  var projectAfter = localStorage.getItem("dsh.worktable.projects.v1");',
    '  var roomsAfterProjects = rooms();',
    '  ok(projectAfter === projectBefore, "adding references does not mutate project master storage");',
    '  ok(roomsAfterProjects.every(function(item) { return !Object.prototype.hasOwnProperty.call(item, "files") && !Object.prototype.hasOwnProperty.call(item, "layoutData") && !Object.prototype.hasOwnProperty.call(item, "project"); }), "rooms contain references, not copied project master data");',
    '  ok(sharedBefore === JSON.stringify(JSON.parse(projectAfter).layouts.find(function(item) { return item.id === "shared-master"; })), "shared master record is unchanged after multi-room association");',
    '  var setRule = execute({ action: "control_room.set_rule", controlRoomId: "room-2", mode: "upsert", rule: { id: "busy-rule", name: "Busy projects", enabled: true, mode: "all", conditions: [{ id: "status", field: "status", operator: "equals", value: "busy" }] } });',
    '  ok(setRule.ok, "sets a real room rule through the production bridge");',
    '  var membershipRule = execute({ action: "control_room.set_rule", controlRoomId: "room-2", mode: "upsert", rule: { id: "rule-project-membership", name: "Rule membership", enabled: true, mode: "all", conditions: [{ id: "name", field: "name", operator: "contains", value: "Rule" }] } });',
    '  ok(membershipRule.ok, "sets a production rule that changes effective project membership");',
    '  window.__dshAcceptanceFlush(); bridge = window.__dshWorktable.controlRooms;',
    '  var membershipAdded = execute({ action: "control_room.search", query: "Rule project", limit: 20 });',
    '  ok(membershipAdded.ok && membershipAdded.data.results.some(function(item) { return item.kind === "project" && item.targetId === "rule-project" && item.roomId === "room-2"; }), "production rule recompute adds a matching project to the effective search corpus");',
    '  var membershipRemoved = execute({ action: "control_room.set_rule", controlRoomId: "room-2", mode: "remove", ruleId: "rule-project-membership" });',
    '  ok(membershipRemoved.ok, "removes the production membership rule through the bridge");',
    '  window.__dshAcceptanceFlush(); bridge = window.__dshWorktable.controlRooms;',
    '  var membershipAfterRemoval = execute({ action: "control_room.search", query: "Rule project", limit: 20 });',
    '  ok(membershipAfterRemoval.ok && !membershipAfterRemoval.data.results.some(function(item) { return item.kind === "project" && item.targetId === "rule-project"; }), "production rule recompute removes the project when the matching rule is removed");',
    '  window.__dshAcceptanceFlush(); bridge = window.__dshWorktable.controlRooms;',
    '  var openOne = execute({ action: "control_room.open", controlRoomId: "room-1" });',
    '  ok(openOne.ok && activeId() === "room-1", "opening room one navigates the production state");',
    '  var traceOne = window.__dshAcceptanceOpenTrace.find(function(item) { return item.id === "wt-console:room-1" && item.active; });',
    '  var geometryOne = traceOne && traceOne.chatW;',
    '  ok(!!traceOne && traceOne.value === true, "production split open returns success for room one");',
    '  var rootDiagnostic = { count: document.querySelectorAll("[data-phase]").length, children: document.querySelector("[data-phase]") && document.querySelector("[data-phase]").children.length, phase: document.querySelector("[data-phase]") && document.querySelector("[data-phase]").dataset.phase, active: window.__dshWorktable.splitStore.active, spec: window.__dshWorktable.splitStore.spec };',
    '  ok(geometryOne === 411, "room one opens with its persisted chat width");',
    '  var openTwo = execute({ action: "control_room.open", controlRoomId: "room-2" });',
    '  ok(openTwo.ok && activeId() === "room-2", "opening room two navigates the production state");',
    '  var traceTwo = window.__dshAcceptanceOpenTrace.find(function(item) { return item.id === "wt-console:room-2" && item.active; });',
    '  var geometryTwo = traceTwo && traceTwo.chatW;',
    '  ok(!!traceTwo && traceTwo.value === true, "production split open returns success for room two");',
    '  ok(geometryTwo === 577, "room two recovers a different persisted chat width");',
    '  ok(geometryOne !== geometryTwo, "room layouts are isolated by real persisted geometry");',
    '  window.__dshAcceptanceFlush(); bridge = window.__dshWorktable.controlRooms;',
    '  var roomSearch = execute({ action: "control_room.search", query: "Room 2", limit: 20 });',
    '  var projectSearch = execute({ action: "control_room.search", query: "Shared master", limit: 20 });',
    '  var sessionSearch = execute({ action: "control_room.search", query: "session-2", limit: 20 });',
    '  var ruleSearch = execute({ action: "control_room.search", query: "Busy projects", limit: 20 });',
    '  ok(roomSearch.ok && roomSearch.data.results.some(function(item) { return item.kind === "room" && item.roomId === "room-2"; }), "search returns the room result kind");',
    '  ok(projectSearch.ok && projectSearch.data.results.some(function(item) { return item.kind === "project" && item.targetId === "shared-master"; }), "search returns the project result kind");',
    '  ok(sessionSearch.ok && sessionSearch.data.results.some(function(item) { return item.kind === "conversation" && item.roomId === "room-2" && item.targetId === "session-2"; }), "search returns the bound conversation result kind");',
    '  ok(ruleSearch.ok && ruleSearch.data.results.some(function(item) { return item.kind === "rule" && item.roomId === "room-2" && item.targetId === "busy-rule"; }), "search returns the rule result kind");',
    '  var searchNavigation = window.__dshWorktable && window.__dshWorktable.controlRoomSearchNavigation;',
    '  window.__dshAcceptanceSessionOpenTrace = [];',
    '  var navigationTrace = []; var navigationContext = "";',
    '  var navigationActions = {',
    '    openControlRoom: function(roomId) { var opened = execute({ action: "control_room.open", controlRoomId: roomId }); var targetRoom = room(roomId); navigationTrace.push({ context: navigationContext, kind: "openControlRoom", roomId: roomId, sessionId: targetRoom && targetRoom.boundSessionId, opened: opened.ok }); },',
    '    openProjectInRoom: function(roomId, projectId) { var opened = execute({ action: "control_room.open", controlRoomId: roomId }); navigationTrace.push({ context: navigationContext, kind: "projectHighlight", roomId: roomId, projectId: projectId, opened: opened.ok }); },',
    '    openRuleEditor: function(roomId, ruleId) { navigationTrace.push({ context: navigationContext, kind: "ruleLocate", roomId: roomId, ruleId: ruleId }); },',
    '  };',
    '  ok(typeof searchNavigation === "function", "production search navigation seam is installed in the browser bridge");',
    '  var roomResult = roomSearch.data.results.find(function(item) { return item.kind === "room"; });',
    '  ok(!!roomResult, "room search produces a navigable result");',
    '  navigationContext = "room"; if (roomResult) searchNavigation(roomResult, navigationActions);',
    '  ok(!!roomResult && navigationTrace.some(function(item) { return item.context === "room" && item.kind === "openControlRoom" && item.roomId === roomResult.roomId && item.opened && activeId() === roomResult.roomId; }), "room search result invokes the production open-room callback");',
    '  var projectResult = projectSearch.data.results.find(function(item) { return item.kind === "project" && item.targetId === "shared-master"; });',
    '  ok(!!projectResult, "project search produces a navigable result");',
    '  navigationContext = "project"; if (projectResult) searchNavigation(projectResult, navigationActions);',
    '  ok(!!projectResult && navigationTrace.some(function(item) { return item.context === "project" && item.kind === "projectHighlight" && item.projectId === "shared-master" && item.opened; }), "project search result invokes the production room-open and project-highlight callback");',
    '  var sessionResult = sessionSearch.data.results.find(function(item) { return item.kind === "conversation" && item.targetId === "session-2"; });',
    '  navigationContext = "conversation"; if (sessionResult) searchNavigation(sessionResult, navigationActions);',
    '  ok(!!sessionResult && navigationTrace.some(function(item) { return item.context === "conversation" && item.kind === "openControlRoom" && item.sessionId === "session-2" && item.opened; }) && window.__dshAcceptanceSessionOpenTrace.indexOf("session-2") >= 0, "conversation search result invokes the production bound-session switch callback");',
    '  var ruleResult = ruleSearch.data.results.find(function(item) { return item.kind === "rule" && item.targetId === "busy-rule"; });',
    '  navigationContext = "rule"; if (ruleResult) searchNavigation(ruleResult, navigationActions);',
    '  ok(!!ruleResult && navigationTrace.some(function(item) { return item.context === "rule" && item.kind === "ruleLocate" && item.ruleId === "busy-rule"; }), "rule search result invokes the production rule-editor locate callback");',
    '  var blocked = execute({ action: "control_room.archive", controlRoomId: "room-0" });',
    '  ok(!blocked.ok && blocked.error.code === "CONFIRMATION_REQUIRED" && !!blocked.confirmation, "archive requires an explicit confirmation token");',
    '  ok(execute({ action: "control_room.archive", controlRoomId: "room-0", confirmationToken: blocked.confirmation.token }).ok, "archive consumes the confirmation token");',
    '  for (var j = 1; j < 10; j += 1) {',
    '    var archiveId = "room-" + j; var pending = execute({ action: "control_room.archive", controlRoomId: archiveId });',
    '    ok(!pending.ok && pending.error.code === "CONFIRMATION_REQUIRED", "archive confirmation is required for " + archiveId);',
    '    ok(execute({ action: "control_room.archive", controlRoomId: archiveId, confirmationToken: pending.confirmation.token }).ok, "archive is reversible for " + archiveId);',
    '  }',
    '  var empty = execute({ action: "control_room.list" });',
    '  ok(empty.ok && empty.data.rooms.length === 0, "last room archive leaves an empty active room list");',
    '  ok(activeId() === null, "last room archive clears active navigation");',
    '  var restored = execute({ action: "control_room.restore", controlRoomId: "room-2" });',
    '  ok(restored.ok, "restores the room from the real browser trash state");',
    '  ok(rooms().length === 1 && rooms()[0].id === "room-2", "restore recovers exactly the requested room");',
    '  ok(room("room-2").projectOrder[0] === "project-a", "restore preserves room project order");',
    '  ok(geometryTwo === 577, "restore preserves the room layout geometry recorded by production open");',
    '  var persistedState = JSON.parse(localStorage.getItem("dsh.worktable.controlRooms.v1"));',
    '  var persistedTrash = JSON.parse(localStorage.getItem("dsh.worktable.controlRooms.trash.v1"));',
    '  ok(persistedState.order.length === 1 && persistedState.order[0] === "room-2", "browser localStorage contains the restored order");',
    '  ok(persistedTrash.deleted.length === 9, "browser trash retains the nine other reversible archives");',
    '  ok(persistedState.rooms["room-2"].projectIds.indexOf("shared-master") >= 0, "restored room still references the shared master");',
    '  ok(sharedBefore === JSON.stringify(JSON.parse(localStorage.getItem("dsh.worktable.projects.v1")).layouts.find(function(item) { return item.id === "shared-master"; })), "master project record is unchanged after archive and restore");',
    '  window.__dshAcceptanceComplete = true;',
    '  return { ok: failures.length === 0, cases: checks.length, failures: failures, roomCount: rooms().length, bindingCount: listed.filter(function(item) { return item.boundSessionId; }).length, sharedProjectUncopied: projectAfter === projectBefore, orderIsolated: JSON.stringify(orderOne) !== JSON.stringify(orderTwo), layoutIsolated: geometryOne !== geometryTwo && geometryTwo === 577, searchNavigationApplied: navigationTrace.length >= 4 && navigationTrace.every(function(item) { return item.opened !== false; }), lastRoomEmpty: empty.data.rooms.length === 0, restored: restored.ok, room1Order: orderOne, room2Order: orderTwo, room1ChatW: geometryOne, room2ChatW: geometryTwo, debug: { roomSearch: roomSearch, projectSearch: projectSearch, sessionSearch: sessionSearch, ruleSearch: ruleSearch, membershipAdded: membershipAdded, membershipAfterRemoval: membershipAfterRemoval, blocked: blocked, empty: empty, restored: restored, navigationTrace: navigationTrace, root: rootDiagnostic, openTrace: window.__dshAcceptanceOpenTrace, split: { active: window.__dshWorktable.splitStore.active, spec: window.__dshWorktable.splitStore.spec, raw: localStorage.getItem("dsh.worktable.split.v2") }, state: localStorage.getItem("dsh.worktable.controlRooms.v1") } };',
    '};',
    'window.__dshAcceptanceReloadCheck = function() {',
    '  var bridge = window.__dshWorktable && window.__dshWorktable.controlRooms;',
    '  var listed = bridge.execute({ action: "control_room.list" });',
    '  var split = JSON.parse(localStorage.getItem("dsh.worktable.split.v2") || "{}");',
    '  var order = listed.data.rooms[0] && listed.data.rooms[0].projectOrder || [];',
    '  return { ok: !!bridge && listed.ok && listed.data.rooms.length === 1 && listed.data.rooms[0].id === "room-2", roomCount: listed.data.rooms.length, activeId: listed.data.activeId, order: order, room1ChatW: split["wt-console:room-1"] && split["wt-console:room-1"].chatW, room2ChatW: split["wt-console:room-2"] && split["wt-console:room-2"].chatW, marker: localStorage.getItem("__dsh_acceptance_browser_v2"), complete: window.__dshAcceptanceComplete === true };',
    '};',
    '</script>',
    '</body></html>',
  ].join('\n')
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address.port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function startFixture() {
  const bundle = fs.readFileSync(finalBundle)
  const server = http.createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      response.end(bundle)
      return
    }
    if (request.url === '/' || request.url === '/index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(fixtureHtml())
      return
    }
    response.writeHead(404)
    response.end('not found')
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, url: 'http://127.0.0.1:' + address.port + '/' })
    })
  })
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    })
    request.once('error', reject)
  })
}

function getHttpStatus(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode || 0))
    })
    request.once('error', reject)
  })
}

async function waitForJson(url, attempts = 100) {
  let lastError = null
  for (let index = 0; index < attempts; index += 1) {
    try { return await getJson(url) } catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 200)) }
  }
  throw lastError || new Error('timed out waiting for ' + url)
}

function createCdp(socket) {
  let id = 0
  const pending = new Map()
  const eventWaiters = new Map()
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw))
    if (message.id) {
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message || 'CDP error'))
      else waiter.resolve(message.result)
      return
    }
    const waiters = eventWaiters.get(message.method)
    if (!waiters) return
    eventWaiters.delete(message.method)
    waiters.forEach((resolve) => resolve(message.params))
  })
  return {
    send(method, params = {}) {
      const messageId = ++id
      return new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject })
        socket.send(JSON.stringify({ id: messageId, method, params }))
      })
    },
    event(method) {
      return new Promise((resolve) => {
        const waiters = eventWaiters.get(method) || []
        waiters.push(resolve)
        eventWaiters.set(method, waiters)
      })
    },
  }
}

async function chromePage(chromePath, profilePath, url) {
  const port = await freePort()
  const child = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port,
    '--user-data-dir=' + profilePath, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  let targets
  try {
    targets = await waitForJson('http://127.0.0.1:' + port + '/json/list')
  } catch (error) {
    await stopChild(child)
    throw error
  }
  const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
  if (!target) {
    await stopChild(child)
    throw new Error('Chrome did not expose a disposable page target')
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await once(socket, 'open')
  const cdp = createCdp(socket)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  const load = cdp.event('Page.loadEventFired')
  await cdp.send('Page.navigate', { url })
  await load
  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception && result.exceptionDetails.exception.description || result.exceptionDetails.text || 'browser evaluation failed')
    }
    return result.result.value
  }
  return { child, socket, cdp, evaluate }
}

function browserExpression(name) {
  return 'window.' + name + '()'
}

async function closeSocket(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return
  await new Promise((resolve) => {
    socket.once('close', resolve)
    socket.close()
  })
}

class RestartPrerequisiteError extends Error {}

async function waitForRuntimeDown(runtimeUrl, attempts = 120) {
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const status = await getHttpStatus(runtimeUrl.href)
      lastError = new Error('runtime still answers HTTP ' + status)
    } catch (error) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw lastError || new Error('disposable runtime did not become unreachable')
}

async function navigateExisting(browser, url) {
  const load = browser.cdp.event('Page.loadEventFired')
  await browser.cdp.send('Page.navigate', { url })
  await load
}

async function runOptionalServiceRestart() {
  if (!process.env.DSH_RUNTIME_COMMAND) {
    return 'service-restart: SKIPPED (exact prerequisite unavailable: DSH_RUNTIME_COMMAND was not supplied)'
  }
  if (!resolveChromePath()) {
    return 'service-restart: SKIPPED (exact prerequisite unavailable: headless Chrome executable not found)'
  }
  if (!process.env.DSH_RUNTIME_ARGS_JSON) {
    return 'service-restart: SKIPPED (exact prerequisite unavailable: DSH_RUNTIME_ARGS_JSON was not supplied; runtime arguments must be an explicit JSON array)'
  }
  if (!process.env.DSH_DISPOSABLE_PROFILE || !process.env.DSH_RUNTIME_URL) {
    return 'service-restart: SKIPPED (exact prerequisite unavailable: disposable profile and DSH_RUNTIME_URL are both required)'
  }
  let runtimeArgs
  try { runtimeArgs = JSON.parse(process.env.DSH_RUNTIME_ARGS_JSON) } catch (error) {
    return 'service-restart: SKIPPED (exact prerequisite unavailable: DSH_RUNTIME_ARGS_JSON is not valid JSON: ' + error.message + ')'
  }
  if (!Array.isArray(runtimeArgs) || runtimeArgs.some((arg) => typeof arg !== 'string')) {
    return 'service-restart: SKIPPED (exact prerequisite unavailable: DSH_RUNTIME_ARGS_JSON must be a JSON array of strings)'
  }
  const runtimeProfile = path.resolve(process.env.DSH_DISPOSABLE_PROFILE)
  assertDisposablePath(runtimeProfile)
  const runtimeUrl = new URL(process.env.DSH_RUNTIME_URL)
  if (!['http:', 'https:'].includes(runtimeUrl.protocol) || !['localhost', '127.0.0.1', '::1'].includes(runtimeUrl.hostname)) {
    throw new Error('DSH_RUNTIME_URL must be a loopback disposable runtime URL')
  }
  const browserProfile = createDisposableProfile('dsh-service-restart-browser-')
  assertDisposablePath(browserProfile)
  let child = null
  let browser = null
  let prerequisiteSkip = null
  try {
    const start = () => {
      child = spawn(process.env.DSH_RUNTIME_COMMAND, runtimeArgs, {
        shell: false,
        detached: process.platform !== 'win32',
        env: { ...process.env, DSH_PROFILE: runtimeProfile, DSH_RUNTIME_PORT: runtimeUrl.port },
        windowsHide: true,
        stdio: 'ignore',
      })
      return child
    }
    const waitReady = async () => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        try {
          const status = await getHttpStatus(runtimeUrl.href)
          if (status >= 200 && status < 500) return
        } catch (error) {
          if (child && child.exitCode !== null) throw error
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new Error('disposable runtime did not become ready')
    }
    const verifyBridge = async () => {
      const identity = await browser.evaluate('({ id: window.__dshLoadedSpec && window.__dshLoadedSpec.id, factory: window.__dshLoadedSpec && typeof window.__dshLoadedSpec.factory, mount: typeof window.__dshAcceptanceMount })')
      if (!identity || identity.id !== 'dsh-worktable' || identity.factory !== 'function' || identity.mount !== 'function') {
        throw new RestartPrerequisiteError('runtime page did not expose the current branch final bundle and WorktableSection effect harness')
      }
      const mount = await browser.evaluate(browserExpression('__dshAcceptanceMount'))
      if (!mount || mount.ok !== true || mount.moduleId !== 'dsh-worktable' || mount.bridgeInstalled !== true || mount.realBrowser !== true) {
        throw new RestartPrerequisiteError('runtime page could not execute the production WorktableSection effect/bridge harness in real Chrome')
      }
    }
    start()
    await waitReady()
    const chromePath = resolveChromePath()
    if (!chromePath) throw new Error('Chrome is required for service restart acceptance')
    browser = await chromePage(chromePath, browserProfile, runtimeUrl.href)
    await verifyBridge()
    const roomId = 'service-restart-room'
    const created = await browser.evaluate('window.__dshWorktable.controlRooms.execute({ action: "control_room.create", controlRoomId: "' + roomId + '", room: { name: "Service restart room" } })')
    if (!created || created.ok !== true) throw new Error('control_room.create did not persist product state before restart: ' + JSON.stringify(created))
    const beforeRestart = await browser.evaluate('window.__dshWorktable.controlRooms.execute({ action: "control_room.get", controlRoomId: "' + roomId + '" })')
    if (!beforeRestart || beforeRestart.ok !== true || beforeRestart.data.id !== roomId) throw new Error('control_room.get did not verify product state before restart')
    await stopChildTree(child)
    child = null
    await waitForRuntimeDown(runtimeUrl)
    start()
    await waitReady()
    await navigateExisting(browser, runtimeUrl.href)
    await verifyBridge()
    const afterRestart = await browser.evaluate('window.__dshWorktable.controlRooms.execute({ action: "control_room.get", controlRoomId: "' + roomId + '" })')
    if (!afterRestart || afterRestart.ok !== true || afterRestart.data.id !== roomId) throw new Error('control_room.get did not recover the same room after disposable runtime restart')
    await stopChildTree(child)
    child = null
    await waitForRuntimeDown(runtimeUrl)
    await closeSocket(browser.socket)
    browser.socket = null
    await stopChild(browser.child)
    browser = null
    return 'service-restart: PASS (disposable runtime start, product bridge create/get, unreachable poll, restart, browser reload, bridge re-wait, product get, stop completed)'
  } catch (error) {
    if (error instanceof RestartPrerequisiteError) prerequisiteSkip = error
    else throw error
  } finally {
    const cleanupErrors = []
    if (browser && browser.socket) {
      try { await closeSocket(browser.socket) } catch (error) { cleanupErrors.push(error) }
    }
    if (browser) {
      try { await stopChild(browser.child) } catch (error) { cleanupErrors.push(error) }
    }
    if (child) {
      try { await stopChildTree(child) } catch (error) { cleanupErrors.push(error) }
      try { await waitForRuntimeDown(runtimeUrl, 40) } catch (error) { cleanupErrors.push(error) }
    }
    try { await removeDisposableProfile(runtimeProfile) } catch (error) { cleanupErrors.push(error) }
    try { await removeDisposableProfile(browserProfile) } catch (error) { cleanupErrors.push(error) }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'service-restart cleanup failed')
  }
  if (prerequisiteSkip) return 'service-restart: SKIPPED (exact prerequisite unavailable: ' + prerequisiteSkip.message + ')'
}

async function main() {
  const chromePath = resolveChromePath()
  if (!chromePath) {
    console.log('control-room-acceptance: SKIPPED (exact prerequisite unavailable: headless Chrome executable not found)')
    console.log('final-bundle Chrome handshake/factory: SKIPPED (exact prerequisite unavailable: headless Chrome executable not found)')
    console.log('browser-domain acceptance: SKIPPED (exact prerequisite unavailable: headless Chrome executable not found)')
    console.log(await runOptionalServiceRestart())
    return
  }
  assert.ok(fs.existsSync(finalBundle), 'final client bundle exists before acceptance')
  const profile = createDisposableProfile('dsh-control-room-acceptance-')
  assertDisposablePath(profile)
  let fixture = null
  let browser = null
  try {
    fixture = await startFixture()
    browser = await chromePage(chromePath, profile, fixture.url)
    const mount = await browser.evaluate(browserExpression('__dshAcceptanceMount'))
    assert.equal(mount.ok, true, 'production WorktableSection effect/bridge harness executed without errors: ' + JSON.stringify(mount.effectErrors))
    assert.equal(mount.moduleId, 'dsh-worktable')
    assert.equal(mount.hasWorktableSection, true)
    assert.equal(mount.bridgeInstalled, true)
    assert.equal(mount.realBrowser, true)
    const result = await browser.evaluate(browserExpression('__dshAcceptanceRun'))
    assert.equal(result.ok, true, 'browser-domain failures: ' + JSON.stringify(result.failures))
    assert.ok(result.cases >= 65, 'acceptance matrix must contain at least 65 substantive checks')
    assert.equal(result.sharedProjectUncopied, true)
    assert.equal(result.orderIsolated, true)
    assert.equal(result.layoutIsolated, true)
    assert.equal(result.searchNavigationApplied, true)
    assert.equal(result.lastRoomEmpty, true)
    assert.equal(result.restored, true)
    const reload = await browser.evaluate('location.reload(); "reloading"')
    void reload
    await browser.cdp.event('Page.loadEventFired')
    const remount = await browser.evaluate(browserExpression('__dshAcceptanceMount'))
    assert.equal(remount.bridgeInstalled, true)
    const reloadCheck = await browser.evaluate(browserExpression('__dshAcceptanceReloadCheck'))
    assert.equal(reloadCheck.ok, true, 'browser reload did not recover the persisted room state')
    assert.equal(reloadCheck.complete, false, 'reload must create a new browser execution context')
    assert.equal(reloadCheck.marker, '1')
    assert.equal(reloadCheck.room1ChatW, 411)
    assert.equal(reloadCheck.room2ChatW, 577)
    console.log('control-room-acceptance: PASS (' + result.cases + ' substantive real-browser checks)')
    console.log('final-bundle Chrome handshake/factory: PASS (current branch bundle loaded from disposable loopback fixture; production WorktableSection and controlRooms bridge installed)')
    console.log('browser-domain acceptance: PASS (real document/window/localStorage; final bundle plus production WorktableSection effect/bridge harness verified project references, independent order/layout, search callbacks, archive/restore, and reload persistence; visual UI acceptance remains pending)')
    console.log(await runOptionalServiceRestart())
  } finally {
    const cleanupErrors = []
    if (browser) {
      try { await closeSocket(browser.socket) } catch (error) { cleanupErrors.push(error) }
      try { await stopChild(browser.child) } catch (error) { cleanupErrors.push(error) }
    }
    if (fixture) {
      try { await new Promise((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve())) } catch (error) { cleanupErrors.push(error) }
    }
    try { await removeDisposableProfile(profile) } catch (error) { cleanupErrors.push(error) }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'control-room acceptance cleanup failed')
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('control-room-acceptance: FAIL', error && error.stack || error)
    process.exitCode = 1
  })
}

module.exports = { fixtureHtml }
