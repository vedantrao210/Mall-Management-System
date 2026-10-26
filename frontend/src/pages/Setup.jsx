import { useState } from 'react'
import ResourcePage from '../components/ResourcePage'
import { Tabs } from '../components/ui'
import { num } from '../format'

// Lookup ("master") tables. They exist so that names are stored once
// (3NF) and referenced by foreign key everywhere else.
const TABS = [
  { key: 'floors', label: 'Floors' },
  { key: 'shop-categories', label: 'Shop categories' },
  { key: 'departments', label: 'Departments' },
  { key: 'expense-categories', label: 'Expense categories' },
]

const describe = [
  { name: 'name', label: 'Name', required: true },
  { name: 'description', label: 'Description', full: true },
]

export default function Setup() {
  const [tab, setTab] = useState('floors')
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Master data</h2>
          <p>Lookup tables referenced by foreign keys. Rows still in use cannot be deleted (ON DELETE RESTRICT).</p>
        </div>
      </div>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'floors' && (
        <ResourcePage key="floors" embedded resource="floors" pk="floor_id" title="Floors" singular="Floor"
          defaultSort="level_number"
          columns={[
            { key: 'level_number', label: 'Level', num: true },
            { key: 'name', label: 'Name', render: (v) => <b>{v}</b> },
            { key: 'shop_count', label: 'Shops', num: true, render: num },
          ]}
          fields={[
            { name: 'level_number', label: 'Level number', type: 'number', min: '-5', max: '50', required: true, help: 'Negative for basement levels' },
            { name: 'name', label: 'Name', required: true },
          ]} />
      )}
      {tab === 'shop-categories' && (
        <ResourcePage key="sc" embedded resource="shop-categories" pk="category_id" title="Shop categories" singular="Category"
          defaultSort="name"
          columns={[
            { key: 'name', label: 'Name', render: (v) => <b>{v}</b> },
            { key: 'description', label: 'Description', wrap: true },
            { key: 'shop_count', label: 'Shops', num: true, render: num },
          ]}
          fields={describe} />
      )}
      {tab === 'departments' && (
        <ResourcePage key="dep" embedded resource="departments" pk="department_id" title="Departments" singular="Department"
          defaultSort="name"
          columns={[
            { key: 'name', label: 'Name', render: (v) => <b>{v}</b> },
            { key: 'description', label: 'Description', wrap: true },
            { key: 'headcount', label: 'Active staff', num: true, render: num },
          ]}
          fields={describe} />
      )}
      {tab === 'expense-categories' && (
        <ResourcePage key="ec" embedded resource="expense-categories" pk="category_id" title="Expense categories" singular="Category"
          defaultSort="name"
          columns={[
            { key: 'name', label: 'Name', render: (v) => <b>{v}</b> },
            { key: 'description', label: 'Description', wrap: true },
            { key: 'expense_count', label: 'Expenses', num: true, render: num },
          ]}
          fields={describe} />
      )}
    </div>
  )
}
