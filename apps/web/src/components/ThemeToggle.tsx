import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

const ThemeToggle = () => {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  return (
    <button
      onClick={toggleTheme}
      className="rounded p-1.5 transition-all hover:bg-light-200 dark:hover:bg-dark-100"
      aria-label={`Switch to ${resolvedTheme === "light" ? "dark" : "light"} theme`}
    >
      {resolvedTheme === "dark" ? (
        <Sun className="h-4 w-4 text-light-900 dark:text-dark-900" />
      ) : (
        <Moon className="h-4 w-4 text-light-900 dark:text-dark-900" />
      )}
    </button>
  );
};

export default ThemeToggle;
