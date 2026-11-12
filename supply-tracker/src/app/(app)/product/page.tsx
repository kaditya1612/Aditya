"use client";
import { PageHeader } from "@/components/ui";
import GroupWorkspace from "@/components/tasks/GroupWorkspace";

export default function ProductManagement() {
  return (
    <>
      <PageHeader title="Product Management" subtitle="New product research, product mapping, activity validation, descriptions, inclusions/exclusions and database updates" />
      <GroupWorkspace groupCodes={["A"]} />
    </>
  );
}
