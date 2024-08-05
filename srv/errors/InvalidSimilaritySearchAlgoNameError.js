class InvalidSimilaritySearchAlgoNameError extends Error{

    constructor(message, code){
        super(message);
        // Set the name of the error to the class name
        this.name = this.constructor.name; 
        // Custom error code
        this.code = code;
        // Capture the stack trace
        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = InvalidSimilaritySearchAlgoNameError;