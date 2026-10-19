import { FileWarning, Image as ImageIcon, MousePointerClick, Search, Smartphone } from "lucide-react";
import type { ModuleId } from "@/lib/types";

export const MODULE_ICONS: Record<ModuleId, typeof Search> = {
  conversion: MousePointerClick,
  content: FileWarning,
  media: ImageIcon,
  seo: Search,
  mobile: Smartphone,
};
