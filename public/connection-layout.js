// Generated from frontend/connection-layout.ts by pnpm build. Do not edit.
export const GRAPH_LIMIT = 160;
export function connectionNeighbor(points, id, direction, singleRowKeys = false) {
    const origin = points.find(point => point.id === id);
    if (!origin)
        return;
    const sameRow = (point) => Math.abs(point.y - origin.y) < .5;
    if (singleRowKeys && points.every(sameRow)) {
        if (direction === 'down')
            direction = 'left';
        else if (direction === 'up')
            direction = 'right';
    }
    if (direction === 'left' || direction === 'right') {
        const right = direction === 'right', row = points.filter(point => sameRow(point) && (right ? point.x > origin.x : point.x < origin.x)).sort((a, b) => right ? a.x - b.x : b.x - a.x);
        if (row.length)
            return row[0].id;
        // At a row boundary, continue in reading order without wrapping the whole map.
        const otherRows = points.filter(point => right ? point.y > origin.y + .5 : point.y < origin.y - .5)
            .sort((a, b) => right ? (a.y - b.y || a.x - b.x) : (b.y - a.y || b.x - a.x));
        return otherRows[0]?.id;
    }
    let best, score = Infinity;
    for (const point of points) {
        const dx = point.x - origin.x, dy = point.y - origin.y;
        const forward = dy * (direction === 'up' ? -1 : 1), across = Math.abs(dx);
        if (forward <= 0)
            continue;
        const distance = forward + across * 3;
        if (distance < score) {
            best = point.id;
            score = distance;
        }
    }
    return best;
}
export const GROUP_CARD = { width: 300, height: 104, gap: 20, padding: 16 };
/** Choose the grid that needs the least scaling for the actual viewport. */
export function connectionGroupLayout(ids, width, height) {
    if (!ids.length)
        return [];
    const { width: w, height: h, gap, padding } = GROUP_CARD;
    let columns = 1, best = Infinity;
    for (let count = 1; count <= ids.length; count++) {
        const rows = Math.ceil(ids.length / count), scale = Math.max((count * (w + gap) - gap + padding * 2) / Math.max(1, width), (rows * (h + gap) - gap + padding * 2) / Math.max(1, height));
        if (scale < best) {
            best = scale;
            columns = count;
        }
    }
    return ids.map((id, i) => ({ id, x: (i % columns) * (w + gap), y: Math.floor(i / columns) * (h + gap) }));
}
/** Wrap titles without cutting surrogate pairs or letting long words escape cards. */
export function connectionTitleLines(title, limit, measure, maxWidth = Infinity) {
    let remaining = Array.from(title.trim().replace(/\s+/g, ' '));
    const lines = [];
    const fits = (chars) => chars.length <= limit && (!measure || measure(chars.join('')) <= maxWidth);
    if (!fits(remaining)) {
        let cut = Math.min(limit, remaining.length);
        while (cut > 1 && !fits(remaining.slice(0, cut)))
            cut--;
        const space = remaining.slice(0, cut + 1).lastIndexOf(' ');
        if (space > 0)
            cut = space;
        lines.push(remaining.slice(0, cut).join(''));
        remaining = Array.from(remaining.slice(cut).join('').trimStart());
    }
    if (!fits(remaining)) {
        let cut = Math.min(limit - 1, remaining.length);
        while (cut > 0 && !fits([...remaining.slice(0, cut), '…']))
            cut--;
        lines.push(remaining.slice(0, cut).join('') + '…');
    }
    else
        lines.push(remaining.join(''));
    return lines;
}
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
