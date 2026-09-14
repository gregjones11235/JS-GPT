import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import PdfUploader from "./components/PdfUploader";
import FileList from "./components/FileList";
import ChatComponent from "./components/ChatComponent";
import RenderQA from "./components/RenderQA";
import { Layout, Typography } from "antd";

const chatComponentStyle = {
  position: "fixed",
  bottom: "0",
  width: "80%",
  left: "10%", // this will center it because it leaves 10% space on each side
  marginBottom: "20px",
};

const pdfUploaderStyle = {
  margin: "auto",
  paddingTop: "80px",
};

const renderQAStyle = {
  height: "50%", // adjust the height as you see fit
  overflowY: "auto",
};

const DOMAIN = process.env.REACT_APP_DOMAIN;

const App = () => {
  const [conversation, setConversation] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState([]);

  const refreshFiles = useCallback(async () => {
    try {
      const response = await axios.get(`${DOMAIN}/files`);
      setFiles(response.data);
    } catch (error) {
      console.error("Error fetching file list: ", error);
    }
  }, []);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);
  const { Header, Content } = Layout;
  const { Title } = Typography;

  const handleResp = (question, answer) => {
     setConversation((prev) => [...prev, { question, answer }]);
  };

  return (
    <>
      <Layout style={{ height: "100vh", backgroundColor: "white" }}>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
          }}
        >
          <Title style={{ color: "white " }}>JS GPT</Title>
        </Header>
        <Content style={{ width: "80%", margin: "auto" }}>
          <div style={pdfUploaderStyle}>
            <PdfUploader onUploaded={refreshFiles} />
          </div>

          <br />
          <FileList files={files} refreshFiles={refreshFiles} />

          <br />
          <br />
          <div style={renderQAStyle}>
            <RenderQA conversation={conversation} isLoading={isLoading} />
          </div>

          <br />
          <br />
        </Content>
        <div style={chatComponentStyle}>
          <ChatComponent
            handleResp={handleResp}
            isLoading={isLoading}
            setIsLoading={setIsLoading}
          />
        </div>
      </Layout>
    </>
  );
};

export default App;
