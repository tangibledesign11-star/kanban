import type { GetServerSideProps } from "next";
import type { McpCatalog } from "@kan/mcp";
import { getMcpToolsCatalog } from "@kan/mcp";

import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import Popup from "~/components/Popup";
import { SettingsLayout } from "~/components/SettingsLayout";
import McpSettings from "~/views/settings/McpSettings";

export interface McpSettingsPageProps {
  catalog: McpCatalog;
}

export const getServerSideProps: GetServerSideProps<
  McpSettingsPageProps
> = () => {
  const catalog = getMcpToolsCatalog();
  return Promise.resolve({
    props: {
      catalog,
    },
  });
};

const McpSettingsPage: NextPageWithLayout<McpSettingsPageProps> = ({
  catalog,
}) => {
  return (
    <SettingsLayout currentTab="mcp">
      <McpSettings catalog={catalog} />
      <Popup />
    </SettingsLayout>
  );
};

McpSettingsPage.getLayout = (page) => getDashboardLayout(page);

export default McpSettingsPage;
