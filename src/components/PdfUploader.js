import React from "react";
import axios from "axios"; // Import axios for HTTP requests
import { InboxOutlined } from "@ant-design/icons";
import { message, Upload } from "antd";

const { Dragger } = Upload;
const DOMAIN = process.env.REACT_APP_DOMAIN;

// Resolves with the axios response, or throws an Error carrying the server's
// message (e.g. "Invalid PDF structure") so the UI can show the real reason.
const uploadToBackend = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  try {
    return await axios.post(`${DOMAIN}/upload`, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
  } catch (error) {
    console.error("Error uploading file: ", error);
    const reason = error.response?.data || error.message;
    throw new Error(reason);
  }
};

const PdfUploader = ({ onUploaded }) => {
  const attributes = {
    name: "file",
    multiple: true,
    accept: ".pdf",
    showUploadList: false, // the FileList component shows what is on the server
    customRequest: async ({ file, onSuccess, onError }) => {
      try {
        const response = await uploadToBackend(file);
        onSuccess(response.data);
      } catch (error) {
        onError(error);
      }
    },
    onChange(info) {
      const { status } = info.file;
      if (status !== "uploading") {
        console.log(info.file, info.fileList);
      }
      if (status === "done") {
        message.success(`${info.file.name} file uploaded successfully.`);
        onUploaded?.();
      } else if (status === "error") {
        const reason = info.file.error?.message || "unknown error";
        message.error(`${info.file.name} upload failed: ${reason}`, 6);
        onUploaded?.();
      }
    },
    onDrop(e) {
      console.log("Dropped files", e.dataTransfer.files);
    },
  };

  return (
    <Dragger {...attributes}>
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p className="ant-upload-text">
        Click or drag file to this area to upload
      </p>
      <p className="ant-upload-hint">
        Support for a single or bulk upload. Strictly prohibited from uploading
        company data or other banned files.
      </p>
    </Dragger>
  );
};

export default PdfUploader;
