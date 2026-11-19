import { useState } from "react";
import { tx } from "../i18n/runtime";

export function BillingProjectPicker({ projects, value, onChange }: { projects: { id: string; name: string }[]; value: string[]; onChange: (value: string[]) => void }) {
  const [search, setSearch] = useState("");
  const visible = projects.filter(project => `${project.name} ${project.id}`.toLowerCase().includes(search.toLowerCase()));
  return <fieldset className="billing-project-picker"><legend>{tx("客户项目（可多选）")}</legend>
    <input type="search" onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} aria-label={tx("搜索项目")} placeholder={tx("搜索项目")} value={search} onChange={event => setSearch(event.target.value)} />
    <div className="billing-project-options">{visible.map(project => <label key={project.id}><input type="checkbox" checked={value.includes(project.id)} onChange={event => onChange(event.target.checked ? [...value, project.id] : value.filter(id => id !== project.id))} /><span>{project.name}<small>{project.id}</small></span></label>)}{visible.length === 0 && <span className="billing-help">{tx("暂无数据")}</span>}</div>
  </fieldset>;
}
