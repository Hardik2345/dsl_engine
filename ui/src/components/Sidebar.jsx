import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  GitBranch, 
  Play, 
  Lightbulb,
  Settings
} from 'lucide-react';
import clsx from 'clsx';

const navItems = [
  { to: '/workflows', icon: GitBranch, label: 'Workflows' },
  { to: '/insights', icon: Lightbulb, label: 'Insights' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col h-screen fixed left-0 top-0">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-gray-800">
        <LayoutDashboard className="w-6 h-6 text-primary-400 mr-3" />
        <span className="font-semibold text-lg">Workflow Engine</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6">
        <ul className="space-y-2">
          {navItems.map(({ to, icon: Icon, label, disabled }) => (
            <li key={to}>
              {disabled ? (
                <span className="flex items-center px-4 py-2.5 text-gray-500 cursor-not-allowed">
                  <Icon className="w-5 h-5 mr-3" />
                  {label}
                </span>
              ) : (
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center px-4 py-2.5 rounded-lg transition-colors',
                      isActive
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    )
                  }
                >
                  <Icon className="w-5 h-5 mr-3" />
                  {label}
                </NavLink>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-gray-800 text-xs text-gray-500">
        DSL Engine v1.0
      </div>
    </aside>
  );
}
