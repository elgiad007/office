// Generated from frontend/connection-layout.ts by pnpm build. Do not edit.
export const GRAPH_LIMIT = 160;
/** Breadth-first layers keep neighbors together without a quadratic force simulation. */
export function connectionLayout(items, links, center = '') {
    const ids = new Set(items.map(item => item.id)), adj = new Map(items.map(item => [item.id, []]));
    for (const { a, b } of links)
        if (ids.has(a) && ids.has(b)) {
            adj.get(a).push(b);
            adj.get(b).push(a);
        }
    const sorted = [...items].sort((a, b) => (adj.get(b.id).length - adj.get(a.id).length) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const seeds = ids.has(center) ? [center, ...sorted.map(item => item.id)] : sorted.map(item => item.id);
    const visited = new Set(), components = [];
    for (const seed of seeds) {
        if (visited.has(seed))
            continue;
        const levels = [[seed]];
        visited.add(seed);
        for (let depth = 0; depth < levels.length; depth++)
            for (const id of levels[depth])
                for (const next of adj.get(id)) {
                    if (visited.has(next))
                        continue;
                    visited.add(next);
                    (levels[depth + 1] ??= []).push(next);
                }
        // Wrap wide layers into columns so a hub with hundreds of peers remains navigable.
        let column = 0;
        const component = [];
        for (const level of levels) {
            for (let i = 0; i < level.length; i++) {
                const row = i % 12, col = Math.floor(i / 12);
                component.push({ id: level[i], x: (column + col) * 270, y: row * 76 });
            }
            column += Math.ceil(level.length / 12);
        }
        components.push(component);
    }
    // Pack disconnected components, including search results, into shelves rather than a tall strip.
    const points = [], shelfWidth = Math.max(1080, ...components.map(component => Math.max(...component.map(p => p.x)) + 270));
    let x = 0, y = 0, rowHeight = 0;
    for (const component of components) {
        const w = Math.max(...component.map(p => p.x)) + 270, h = Math.max(...component.map(p => p.y)) + 100;
        if (x + w > shelfWidth) {
            x = 0;
            y += rowHeight + 40;
            rowHeight = 0;
        }
        points.push(...component.map(p => ({ id: p.id, x: p.x + x, y: p.y + y })));
        x += w;
        rowHeight = Math.max(rowHeight, h);
    }
    return points;
}
/** Keep a selected item and its neighbors inside the bounded visible map. */
export function visibleConnectionItems(items, links, selected = '', center = '') {
    const priority = new Set([selected, center].filter(Boolean));
    for (const edge of links)
        if (edge.a === selected || edge.b === selected) {
            priority.add(edge.a);
            priority.add(edge.b);
        }
    const pinned = new Set([selected, center]), byId = new Map(items.map(item => [item.id, item]));
    return [...[...pinned].flatMap(id => byId.has(id) ? [byId.get(id)] : []), ...items.filter(item => priority.has(item.id) && !pinned.has(item.id)), ...items.filter(item => !priority.has(item.id))].slice(0, GRAPH_LIMIT);
}
