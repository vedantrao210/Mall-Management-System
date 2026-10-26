import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { label } from '../format'
import Icon from './Icons'
import {
  ConfirmDialog, DataTable, ErrorBox, FormGrid, Modal, Pagination,
  clearOptionCache, coerce, useDebounced, useOptions, useToast,
} from './ui'

/**
 * Generic list + create/edit/delete screen driven by a configuration object
 * (same idea as the backend `Resource`). Props:
 *   resource       API path segment, e.g. "shops"
 *   pk             primary-key field
 *   title, singular, description
 *   columns        [{key, label, render?, num?, sortable?}]
 *   fields         form fields for create (see FormField)
 *   editFields     form fields for edit (defaults to `fields`)
 *   filters        [{name, label, options | optionsFrom}]
 *   canCreate/canEdit/canDelete  role arrays (default: admin, manager)
 *   rowActions     (row, reload) => extra buttons
 *   toolbar        (reload) => extra toolbar buttons
 *   defaults       initial values for the create form
 */
export default function ResourcePage({
  resource, pk, title, singular, description, columns, fields, editFields, filters = [],
  canCreate = ['admin', 'manager'], canEdit = ['admin', 'manager'], canDelete = ['admin', 'manager'],
  rowActions, toolbar, defaults = {}, defaultSort, defaultOrder = 'asc', embedded, deleteLabel = 'Delete',
}) {
  const { hasRole } = useAuth()
  const notify = useToast()
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterValues, setFilterValues] = useState({})
  const [sort, setSort] = useState(defaultSort)
  const [order, setOrder] = useState(defaultOrder)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [editing, setEditing] = useState(null) // {mode:'create'|'edit', row, values}
  const [deleting, setDeleting] = useState(null)
  const debounced = useDebounced(search)

  const load = useCallback(() => {
    setLoading(true)
    api(`/${resource}`, { params: { search: debounced, sort, order, page, page_size: pageSize, ...filterValues } })
      .then((d) => { setData(d); setError(null) })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [resource, debounced, sort, order, page, pageSize, filterValues])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [debounced, filterValues, pageSize])

  const onSort = (key) => {
    if (sort === key) setOrder(order === 'asc' ? 'desc' : 'asc')
    else { setSort(key); setOrder('asc') }
  }

  const formFields = editing?.mode === 'edit' ? (editFields || fields) : fields
  const openCreate = () => setEditing({ mode: 'create', values: { ...defaults }, error: null })
  const openEdit = (row) => {
    const values = {}
    ;(editFields || fields).forEach((f) => { values[f.name] = row[f.name] })
    setEditing({ mode: 'edit', row, values, original: { ...values }, error: null })
  }

  const save = async (e) => {
    e.preventDefault()
    setEditing((s) => ({ ...s, busy: true, error: null }))
    try {
      let body = coerce(formFields, editing.values)
      if (editing.mode === 'edit') {
        const orig = coerce(formFields, editing.original)
        body = Object.fromEntries(Object.entries(body).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(orig[k])))
        if (Object.keys(body).length) await api(`/${resource}/${editing.row[pk]}`, { method: 'PATCH', body })
        notify(`${singular} updated`)
      } else {
        await api(`/${resource}`, { method: 'POST', body })
        notify(`${singular} created`)
      }
      clearOptionCache(resource)
      setEditing(null)
      load()
    } catch (err) {
      setEditing((s) => ({ ...s, busy: false, error: err }))
    }
  }

  const allowEdit = hasRole(...canEdit)
  const allowDelete = hasRole(...canDelete)
  const showActions = allowEdit || allowDelete || rowActions

  return (
    <div className="stack">
      {!embedded && (
        <div className="page-head">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <div className="row">
            {toolbar && toolbar(load)}
            {fields && hasRole(...canCreate) && (
              <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" /> New {singular.toLowerCase()}</button>
            )}
          </div>
        </div>
      )}
      <div className="card">
        <div className="table-toolbar">
          <div className="search">
            <Icon name="search" />
            <input className="input sm" placeholder={`Search ${title.toLowerCase()}…`} value={search}
              onChange={(e) => setSearch(e.target.value)} />
          </div>
          {filters.map((f) => (
            <FilterSelect key={f.name} filter={f} value={filterValues[f.name] || ''}
              onChange={(v) => setFilterValues((s) => ({ ...s, [f.name]: v }))} />
          ))}
          <div className="spacer" />
          {embedded && fields && hasRole(...canCreate) && (
            <button className="btn btn-primary btn-sm" onClick={openCreate}><Icon name="plus" /> New {singular.toLowerCase()}</button>
          )}
          <button className="btn btn-sm btn-ghost" onClick={load} title="Refresh"><Icon name="refresh" /></button>
        </div>
        {error && <div style={{ padding: 14 }}><ErrorBox error={error} /></div>}
        <DataTable
          columns={columns}
          rows={data.items.map((r) => ({ ...r, id: r[pk] }))}
          sort={sort}
          order={order}
          onSort={onSort}
          loading={loading}
          actions={showActions ? (row) => (
            <>
              {rowActions && rowActions(row, load)}
              {allowEdit && fields && <button className="link-btn" onClick={() => openEdit(row)}>Edit</button>}
              {allowDelete && <button className="link-btn danger" onClick={() => setDeleting(row)}>{deleteLabel}</button>}
            </>
          ) : undefined}
        />
        <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={setPageSize} />
      </div>

      {editing && (
        <Modal
          title={editing.mode === 'edit' ? `Edit ${singular.toLowerCase()}` : `New ${singular.toLowerCase()}`}
          onClose={() => setEditing(null)}
          footer={<>
            <button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" type="submit" form="resource-form" disabled={editing.busy}>
              {editing.busy ? 'Saving…' : 'Save'}
            </button>
          </>}
        >
          <form id="resource-form" onSubmit={save} className="stack">
            <FormGrid fields={formFields} values={editing.values} onChange={(values) => setEditing((s) => ({ ...s, values }))} />
            <ErrorBox error={editing.error} />
          </form>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title={`${deleteLabel} ${singular.toLowerCase()}`}
          danger
          confirmText={deleteLabel}
          message={<>Are you sure? This cannot be undone. If other records reference this {singular.toLowerCase()}, the database will refuse (foreign key <code>RESTRICT</code>).</>}
          onConfirm={async () => {
            await api(`/${resource}/${deleting[pk]}`, { method: 'DELETE' })
            clearOptionCache(resource)
            notify(`${singular} deleted`)
            load()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

function FilterSelect({ filter, value, onChange }) {
  const remote = useOptions(filter.optionsFrom)
  const options = filter.options
    ? filter.options.map((o) => (typeof o === 'string' ? { value: o, label: label(o) } : o))
    : remote
  return (
    <select className="input sm" style={{ width: 'auto', minWidth: 140 }} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{filter.label}: all</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
