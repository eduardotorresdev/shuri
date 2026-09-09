/**
 * The admin's components, for embedding into an app of your own rather than running the whole
 * `@shuri/ui` SPA. Everything here is generic over a schema — hand `RecordForm` a collection's
 * `fields` and it renders that collection's form, with no per-collection code.
 *
 * Pair it with the stylesheet, which carries the tokens the components are written against:
 *
 *   import "@shuri/ui/admin.css";
 *   import { RecordForm } from "@shuri/ui/components";
 *
 * The contract types and the HTTP client live in `@shuri/ui/shared`, re-exported here so a
 * consumer needs one import.
 */
export * from "../shared/index.js";

export { default as AdminShell } from "./layout/AdminShell.svelte";
export { default as PageHeader } from "./layout/PageHeader.svelte";
export { default as SideNav } from "./layout/SideNav.svelte";
export * from "./layout/nav.js";

export { default as AuthCard } from "./auth/AuthCard.svelte";
export { default as SetupScreen } from "./auth/SetupScreen.svelte";
export { default as LoginScreen } from "./auth/LoginScreen.svelte";
export { default as ForbiddenScreen } from "./auth/ForbiddenScreen.svelte";
export { default as UserMenu } from "./auth/UserMenu.svelte";

export { default as FieldControl } from "./fields/FieldControl.svelte";
export { default as BooleanControl } from "./fields/BooleanControl.svelte";
export { default as EmailControl } from "./fields/EmailControl.svelte";
export { default as NumberControl } from "./fields/NumberControl.svelte";
export { default as RelationControl } from "./fields/RelationControl.svelte";
export { default as SelectControl } from "./fields/SelectControl.svelte";
export { default as TextControl } from "./fields/TextControl.svelte";
export { default as TextareaControl } from "./fields/TextareaControl.svelte";
export * from "./fields/relations.js";
export * from "./fields/values.js";

export { default as RecordForm } from "./forms/RecordForm.svelte";
export { default as IssueSummary } from "./forms/IssueSummary.svelte";

export { default as UserForm } from "./users/UserForm.svelte";

export { default as RecordTable } from "./lists/RecordTable.svelte";
export { default as Pager } from "./lists/Pager.svelte";
export { default as ListFilters } from "./lists/ListFilters.svelte";
export { default as FilterControl } from "./lists/FilterControl.svelte";
export * from "./lists/columns.js";
export * from "./lists/filters.js";
export * from "./lists/paging.js";

export { default as Alert } from "./ui/Alert.svelte";
export { default as Button } from "./ui/Button.svelte";
export { default as ConfirmDialog } from "./ui/ConfirmDialog.svelte";
export { default as EmptyState } from "./ui/EmptyState.svelte";
export { default as FormField } from "./ui/FormField.svelte";
export { default as Icon } from "./ui/Icon.svelte";
export { default as Spinner } from "./ui/Spinner.svelte";
export * from "./ui/icons.js";
