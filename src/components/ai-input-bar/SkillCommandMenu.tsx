import { Command } from 'lucide-react'
import type { SkillInstallation } from '../../shared/contracts/skills'
import './SkillCommandMenu.css'

export function SkillCommandMenu({
  skills,
  activeIndex,
  onActiveIndex,
  onSelect,
}: {
  skills: readonly SkillInstallation[]
  activeIndex: number
  onActiveIndex: (index: number) => void
  onSelect: (skill: SkillInstallation) => void
}): React.ReactElement {
  return <div id="skill-command-menu" className="skill-command-menu" role="listbox" aria-label="选择本轮 Skill">
    <div className="skill-command-menu__title"><Command size={14} /><span>本轮调用 Skill</span><kbd>/</kbd></div>
    {skills.length ? <div className="skill-command-menu__list">
      {skills.map((skill, index) => <button
        key={skill.id}
        id={`skill-command-option-${index}`}
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        className={index === activeIndex ? 'active' : ''}
        onMouseEnter={() => onActiveIndex(index)}
        onClick={() => onSelect(skill)}
      >
        <Command size={14} />
        <span><strong>{skill.displayName}</strong><small>/{skill.name}{skill.description ? ` · ${skill.description}` : ''}</small></span>
      </button>)}
    </div> : <p>没有匹配的已授权 Skill</p>}
  </div>
}
