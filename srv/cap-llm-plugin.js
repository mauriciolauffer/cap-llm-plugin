// const cds = require("@sap/cds");
const InvalidSimilaritySearchAlgoNameError = require("./errors/InvalidSimilaritySearchAlgoNameError");

class CAPLLMPlugin extends cds.Service {
  async init() {
    await super.init();
  }

  /**
   * Retrieve anonymized data for a given entity.
   * @param {string} entityName - Name of the entity.
   * @param {number[]} sequenceIds - Optional Sequence IDs of the entity to retrieve the data. Default is an empty array.
   * @returns {object} - The retrieved anonymized data.
   */
  async getAnonymizedData(entityName, sequenceIds = []) {
    try {
      let [entityService, serviceEntity] = entityName.split(".");
      const entity = cds?.services?.[entityService]?.entities?.[serviceEntity];
      const sequenceColumn = Object.values(entity.elements).find(
        (element) =>
          typeof element["@anonymize"] === "string" &&
          element["@anonymize"].replace(/\s+/g, "").includes("is_sequence")
      );
      if (sequenceColumn === undefined) {
        throw new Error(
          `Sequence column for entity "${entity.name}" not found!`
        );
      }
      const viewName =
        entityName.toUpperCase().replace(/\./g, "_") + "_ANOMYZ_V";
      let query = `select * from "${viewName}"\n`;

      if (sequenceIds.length > 0) {
        query += `where "${sequenceColumn?.name?.toUpperCase()}" in (${sequenceIds
          .map((value) => `'${value}'`)
          .join(", ")});`;
      }

      return await cds.db.run(query);
    } catch (e) {
      console.log(
        `Retrieving anonymized data from SAP HANA Cloud failed. Ensure that the entityName passed exactly matches the format "<service_name>.<entity_name>". Error: `,
        e
      );
      throw e;
    }
  }

  /**
   * get vector embeddings.
   * @param {object} config - The configuration for the embedding model.
   * @param {object} input - The input string to be embedded.
   * @returns {object} - Returns the vector embeddings.
   */
  async getEmbedding(config, input) {
    try {
      const mandatoryParams = [
        "destinationName",
        "resourceGroup",
        "deploymentUrl",
        "modelName",
      ];

      const modelWithApiVersion = new Set(["text-embedding-ada-002"]);

      //check if mandatory keys are present
      mandatoryParams.forEach((key) => {
        if (!config.hasOwnProperty(key)) {
          throw new Error(`The config is missing parameter: "${key}"`);
        }
      });

      if (modelWithApiVersion.has(config.modelName) && !config.hasOwnProperty("apiVersion")) {
          throw new Error(` The config must contain "apiVersion" parameter.`);
      }

      const modelUrlMapping = {
        "text-embedding-ada-002": `POST ${config.deploymentUrl}/embeddings?api-version=${config.apiVersion}`,
      };

      if (!modelUrlMapping.hasOwnProperty(config.modelName)) {
        throw new Error(`Model ${config.modelName} not supported.:`);
      }

      let modelUrl = modelUrlMapping[config.modelName];

      const destService = await cds.connect.to(`${config.destinationName}`);
      const payload = {
        input: input,
      };
      const headers = {
        "Content-Type": "application/json",
        "AI-Resource-Group": `${config.resourceGroup}`,
      };

      const response = await destService.send({
        query: modelUrl,
        data: payload,
        headers: headers,
      });

      if (response && response.data) {
        return response;
      } else {
        // Handle case where response or response.data is empty
        throw new Error("Empty response or response data.");
      }
    } catch (error) {
      // Handle any errors that occur during the execution
      console.log("Error getting embedding response:", error);
      throw error;
    }
  }

  /**
   * Perform Chat Completion.
   * @param {object} config - The configuration for the chat completion model.
   * @param {object} payload - The payload for the chat completion model.
   * @returns {object} - The chat completion results from the model.
   */
  async getChatCompletion(config, payload) {
    try {
      const mandatoryParams = [
        "destinationName",
        "resourceGroup",
        "deploymentUrl",
        "modelName",
      ];
      const modelWithApiVersion = new Set(["gpt", "gemini-1.0-pro"]);

      //check if mandatory keys are present
      mandatoryParams.forEach((key) => {
        if (!config.hasOwnProperty(key)) {
          throw new Error(`The config is missing parameter: "${key}"`);
        }
      });

      const modelType = config.modelName.startsWith("gpt")
        ? "gpt"
        : config.modelName;
        
      if (modelWithApiVersion.has(modelType)) {
        if (!config.hasOwnProperty("apiVersion"))
          throw new Error(` The config must contain "apiVersion" parameter.`);
      }

      const modelUrlMapping = {
        gpt: `POST ${config.deploymentUrl}/chat/completions?api-version=${config.apiVersion}`,
        "gemini-1.0-pro": `POST ${config.deploymentUrl}/models/gemini-1.0-pro-${config.apiVersion}:generateContent`,
        claude: `POST ${config.deploymentUrl}/invoke`,
      };

      if (!modelUrlMapping.hasOwnProperty(modelType)) {
        throw new Error(`Model ${config.modelName} not supported.:`);
      }

      let modelUrl = modelUrlMapping[modelType];

      const destService = await cds.connect.to(`${config.destinationName}`);
      const headers = {
        "Content-Type": "application/json",
        "AI-Resource-Group": `${config.resourceGroup}`,
      };

      const response = await destService.send({
        query: modelUrl,
        data: payload,
        headers: headers,
      });
        
      if (response) return response;
      else {
        throw new Error( "Empty response or response data.");
      }
    } catch (error) {
      // Handle any errors that occur during the execution
      throw error;
    }
  }

  /**
   * Retrieve RAG response from LLM.
   * @param {string} input - User input.
   * @param {string} tableName - The full name of the SAP HANA Cloud table which contains the vector embeddings.
   * @param {string} embeddingColumnName - The full name of the SAP HANA Cloud table column which contains the embeddings.
   * @param {string} contentColumn - The full name of the SAP HANA Cloud table column which contains the page content.
   * @param {string} chatInstruction - The custom prompt user can pass in. Important: Ensure that the prompt contains the message "content which is enclosed in triple quotes".
   * @param {object} embeddingConfig - The configuration for the embedding model.
   * @param {object} chatConfig - The configuration for the chat completion model. 
   * @param {object} context - Optional.The chat history.
   * @param {number} topK - Optional.The number of the entries you want to return. Default value is 3.
   * @param {string} algoName - Optional.The algorithm of similarity search. Currently only COSINE_SIMILARITY and L2DISTANCE are accepted. The default is 'COSINE_SIMILARITY'.
   * @param {object} chatParams - Optional.The other chat model params.
   * @returns {object} Returns the response from LLM.
   */
  async getRagResponse(
    input,
    tableName,
    embeddingColumnName,
    contentColumn,
    chatInstruction,
    embeddingConfig,
    chatConfig,
    context,
    topK = 3,
    algoName = "COSINE_SIMILARITY",
    chatParams
  ) {
    try {
      const queryEmbedding = await this.getEmbedding(embeddingConfig, input);
      const similaritySearchResults = await this.similaritySearch(
        tableName,
        embeddingColumnName,
        contentColumn,
        queryEmbedding,
        algoName,
        topK
      );
      const similarContent = similaritySearchResults.map(
        (obj) => obj.PAGE_CONTENT
      );
      const additionalContents = similaritySearchResults.map((obj) => {
        return {
          score: obj.SCORE,
          pageContent: obj.PAGE_CONTENT,
        };
      });
      let messagePayload = [
        {
          role: "system",
          content: ` ${chatInstruction} \`\`\` ${similarContent} \`\`\` `,
        },
      ];

      const userQuestion = [
        {
          role: "user",
          content: `${input}`,
        },
      ];

      if (
        typeof context !== "undefined" &&
        context !== null &&
        context.length > 0
      ) {
        console.log("Using the context parameter passed.");
        messagePayload.push(...context);
      }

      messagePayload.push(...userQuestion);

      let payload = {
        messages: messagePayload,
      };
      if (
        chatParams !== null &&
        chatParams !== undefined &&
        Object.keys(chatParams).length > 0
      ) {
        console.log("Using the chatParams parameter passed.");
        payload = Object.assign(payload, chatParams);
      }
      console.log("payload is", payload);
      const chatCompletionResp = await this.getChatCompletion(
        chatConfig,
        payload
      );

      const ragResp = {
        completion: chatCompletionResp,
        additionalContents: additionalContents,
      };

      return ragResp;
    } catch (error) {
      // Handle any errors that occur during the execution
      console.log("Error during execution:", error);
      throw error;
    }
  }


  /**
   * Perform Similarity Search.
   * @param {string} tableName - The full name of the SAP HANA Cloud table which contains the vector embeddings.
   * @param {string} embeddingColumnName - The full name of the SAP HANA Cloud table column which contains the embeddings.
   * @param {string} contentColumn -  The full name of the SAP HANA Cloud table column which contains the page content.
   * @param {number[]} embedding - The input query embedding for similarity search.
   * @param {string} algoName - The algorithm of similarity search. Currently only COSINE_SIMILARITY and L2DISTANCE are accepted.
   * @param {number} topK - The number of entries you want to return.
   * @returns {object} The highest match entries from DB.
   */
  async similaritySearch(
    tableName,
    embeddingColumnName,
    contentColumn,
    embedding,
    algoName,
    topK
  ) {
    try {
      // Ensure algoName is valid
      const validAlgorithms = ["COSINE_SIMILARITY", "L2DISTANCE"];
      if (!validAlgorithms.includes(algoName)) {
        throw new InvalidSimilaritySearchAlgoNameError(
          `Invalid algorithm name: ${algoName}. Currently only COSINE_SIMILARITY and L2DISTANCE are accepted.`,
          400
        );
      }
      let sortDirection = "DESC";
      if ("L2DISTANCE" === algoName) {
        sortDirection = "ASC";
      }
      // const embedding_str = `'[${embedding.toString()}]'`
      const embedding_str = `'[${embedding.data[0].embedding.toString()}]'`
      const selectStmt = `SELECT TOP ${topK} *,TO_NVARCHAR(${contentColumn}) as PAGE_CONTENT,${algoName}(${embeddingColumnName}, TO_REAL_VECTOR(${embedding_str})) as SCORE FROM ${tableName} ORDER BY SCORE ${sortDirection}`;
      const result = await cds.db.run(selectStmt);
      if (result) return result;
    } catch (e) {
      if (e instanceof InvalidSimilaritySearchAlgoNameError) {
        throw e;
      } else {
        console.log(
          `Similarity Search failed for entity ${tableName} on attribute ${embeddingColumnName}`,
          e
        );
        throw e;
      }
    }
  }
}

module.exports = CAPLLMPlugin;