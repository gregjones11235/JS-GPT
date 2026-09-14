import React from "react";
import axios from "axios";
import { List, Button, Tag, Popconfirm, message, Typography } from "antd";
import { DeleteOutlined, FilePdfOutlined } from "@ant-design/icons";

const DOMAIN = process.env.REACT_APP_DOMAIN;

const formatSize = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

const FileList = (props) => {
  const { files, refreshFiles } = props;

  const onDelete = async (name) => {
    try {
      await axios.delete(`${DOMAIN}/files/${encodeURIComponent(name)}`);
      message.success(`${name} deleted.`);
    } catch (error) {
      console.error("Error deleting file: ", error);
      message.error(`Failed to delete ${name}.`);
    } finally {
      refreshFiles();
    }
  };

  const onSelect = async (name) => {
    try {
      await axios.post(`${DOMAIN}/files/${encodeURIComponent(name)}/select`);
      message.success(`Now chatting with ${name}.`);
    } catch (error) {
      console.error("Error selecting file: ", error);
      message.error(`Failed to select ${name}.`);
    } finally {
      refreshFiles();
    }
  };

  const onDeselect = async () => {
    try {
      await axios.post(`${DOMAIN}/files/deselect`);
      message.info("No file is active.");
    } catch (error) {
      console.error("Error deselecting file: ", error);
      message.error("Failed to deactivate.");
    } finally {
      refreshFiles();
    }
  };

  return (
    <List
      size="small"
      header={<Typography.Text strong>Uploaded files</Typography.Text>}
      locale={{ emptyText: "No files uploaded yet" }}
      dataSource={files}
      renderItem={(file) => (
        <List.Item
          actions={[
            file.active ? (
              <Button size="small" onClick={onDeselect}>
                Deactivate
              </Button>
            ) : (
              <Button size="small" onClick={() => onSelect(file.name)}>
                Use
              </Button>
            ),
            <Popconfirm
              title={`Delete ${file.name}?`}
              description="The file and its index will be removed."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => onDelete(file.name)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>,
          ].filter(Boolean)}
        >
          <List.Item.Meta
            avatar={<FilePdfOutlined style={{ fontSize: 20, color: "#cf1322" }} />}
            title={
              <>
                {file.name}{" "}
                {file.active && <Tag color="blue">active</Tag>}
                {!file.indexed && <Tag color="orange">not indexed</Tag>}
              </>
            }
            description={`${formatSize(file.size)} · ${new Date(
              file.uploadedAt
            ).toLocaleString()}`}
          />
        </List.Item>
      )}
    />
  );
};

export default FileList;
