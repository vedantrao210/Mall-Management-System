import { useMemo, useState } from 'react'

// Live entity-relationship diagram drawn from INFORMATION_SCHEMA metadata.
// Known tables get a hand-tuned position; any new table is placed in a grid.
const W = 230
const HEAD = 30
const ROW = 19
const LAYOUT = {
  floors: [20, 20], shop_categories: [20, 150],
  shops: [300, 20], maintenance_requests: [300, 245],
  departments: [20, 545], employees: [300, 545],
  leases: [580, 20], tenants: [580, 295], audit_log: [580, 545],
  invoices: [860, 20], expense_categories: [860, 600],
  payments: [1140, 20], app_users: [1140, 255], expenses: [1140, 500],
}

function boxHeight(t) { return HEAD + t.columns.length * ROW + 8 }

export default function ErDiagram({ data, onSelect }) {
  const [hover, setHover] = useState(null)

  const boxes = useMemo(() => {
    const out = {}
    let extra = 0
    data.tables.forEach((t) => {
      let pos = LAYOUT[t.name]
      if (!pos) { pos = [20 + (extra % 5) * 280, 820 + Math.floor(extra / 5) * 300]; extra += 1 }
      out[t.name] = { ...t, x: pos[0], y: pos[1], h: boxHeight(t) }
    })
    return out
  }, [data])

  const width = Math.max(...Object.values(boxes).map((b) => b.x + W)) + 20
  const height = Math.max(...Object.values(boxes).map((b) => b.y + b.h)) + 20

  const colY = (box, col) => {
    const i = box.columns.findIndex((c) => c.name === col)
    return box.y + HEAD + (i < 0 ? 0 : i) * ROW + ROW / 2 + 2
  }

  const links = data.relations.map((r) => {
    const a = boxes[r.from_table]
    const b = boxes[r.to_table]
    if (!a || !b) return null
    const y1 = colY(a, r.from_column)
    const y2 = colY(b, r.to_column)
    let x1, x2, c1, c2
    if (b.x + W < a.x) { x1 = a.x; x2 = b.x + W; c1 = x1 - 50; c2 = x2 + 50 }
    else if (b.x > a.x + W) { x1 = a.x + W; x2 = b.x; c1 = x1 + 50; c2 = x2 - 50 }
    else { x1 = a.x; x2 = b.x; c1 = x1 - 45; c2 = x2 - 45 } // same column: loop on the left
    const active = hover && (hover === r.from_table || hover === r.to_table)
    return { ...r, d: `M${x1},${y1} C${c1},${y1} ${c2},${y2} ${x2},${y2}`, active }
  }).filter(Boolean)

  return (
    <div className="er-canvas">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: 'block', minWidth: 980 }}>
        <defs>
          <marker id="many" viewBox="0 0 14 14" refX="1" refY="7" markerWidth="14" markerHeight="14" orient="auto-start-reverse">
            <path d="M13,7 L1,1 M13,7 L1,13 M13,7 L1,7" stroke="#64748b" strokeWidth="1.4" fill="none" />
          </marker>
          <marker id="one" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto">
            <path d="M8,1 L8,11 M4,1 L4,11" stroke="#64748b" strokeWidth="1.4" />
          </marker>
        </defs>
        {links.map((l) => (
          <path key={l.name} d={l.d} fill="none" stroke={l.active ? '#4f46e5' : '#94a3b8'}
            strokeWidth={l.active ? 2.2 : 1.3} opacity={hover && !l.active ? 0.25 : 1}
            markerStart="url(#many)" markerEnd="url(#one)">
            <title>{`${l.from_table}.${l.from_column} → ${l.to_table}.${l.to_column} (${l.name})`}</title>
          </path>
        ))}
        {Object.values(boxes).map((b) => (
          <g key={b.name} className="er-table" transform={`translate(${b.x},${b.y})`}
            onMouseEnter={() => setHover(b.name)} onMouseLeave={() => setHover(null)}
            onClick={() => onSelect && onSelect(b.name)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
            <rect width={W} height={b.h} rx="8" fill="#fff" stroke={hover === b.name ? '#4f46e5' : '#cbd5e1'}
              strokeWidth={hover === b.name ? 2 : 1} filter="drop-shadow(0 1px 2px rgba(15,23,42,.08))" />
            <path d={`M0,8 a8,8 0 0 1 8,-8 h${W - 16} a8,8 0 0 1 8,8 v${HEAD - 8} h-${W} z`} fill={b.name === 'audit_log' ? '#475569' : '#4f46e5'} />
            <text x="10" y="20" fill="#fff" fontWeight="700" fontSize="12.5">{b.name}</text>
            {b.columns.map((c, i) => {
              const y = HEAD + i * ROW + 15
              return (
                <g key={c.name}>
                  <text x="10" y={y} fontSize="11" fontWeight={c.key === 'PRI' ? 700 : 400}
                    fill={c.key === 'PRI' ? '#4338ca' : c.is_fk ? '#0369a1' : '#0f172a'}
                    fontStyle={c.is_generated ? 'italic' : 'normal'}>
                    {c.key === 'PRI' ? '🔑 ' : c.is_fk ? '↗ ' : ''}{c.name}{c.nullable ? '' : ' *'}
                  </text>
                  <text x={W - 10} y={y} fontSize="10" fill="#94a3b8" textAnchor="end">
                    {c.type.replace(' unsigned', '').replace(/^enum\(.*\)$/, 'enum').slice(0, 16)}
                  </text>
                </g>
              )
            })}
          </g>
        ))}
      </svg>
    </div>
  )
}
