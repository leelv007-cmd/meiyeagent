import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminRecipeStudioControl } from '@/p1/admin-recipe-studio-control';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/recipe-studio')({
  component: RecipeStudioPage,
});

function RecipeStudioPage() {
  return (
    <AdminRoutePage
      title="Recipe Studio"
      description="用受控积木编译 Recipe，并依次完成校验、评测、内测与生产切换。"
    >
      <AdminRecipeStudioControl />
    </AdminRoutePage>
  );
}
