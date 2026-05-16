const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");

var attachmentExtractorApi = class extends ExtensionCommon.ExtensionAPI {
	getAPI(context) {
		// Constants
		const MAX_FILENAMES_FOR_DIALOG = 20;

		let useTemplate = false;
		let filenameFormat = { value: "%date%_%fromMail%_%subject%_%filename%" };
		let selectedFolder = null;
		let usedFilenames = {};

		// Helper inline function for preparing filenames for displaying to the user
		const prepareFilesNamesForDisplaying = function(filenames, max_filenames) {
			// filter non-empty filenames and deduplicate the list
			const filteredFileNames = [...new Set(filenames.map(s => s.trim()).filter(s => s.length > 0))];
			if (filteredFileNames.length > max_filenames) {
				const slicedFileNames = filteredFileNames.slice(0, max_filenames);
				slicedFileNames.push(`and ${filteredFileNames.length - max_filenames} more`);
				return slicedFileNames;
			}
			return filteredFileNames;
		};

		const getFilenameForAttachment = function(messageId, attachmentName) {
			// Handle filename
			let filename = filenameFormat.value;
			const [_, filenameWithoutExtension, filenameExtension] = attachmentName.match(/(.*)(\..*)$/) || [null, attachmentName, ""];
			if (useTemplate) {
				const message = context.extension.messageManager.get(messageId);
				const authorRegex = /(.*)?<(.*)>/;
				const [_, authorName, authorMail] = message.mime2DecodedAuthor.match(authorRegex) || [null, null, message.mime2DecodedAuthor];
				const [messageDate, messageTime] = (new Date(message.date / 1000)).toISOString().split("T");
				filename = filename
					.replace("%date%", messageDate)
					.replace("%time%", messageTime)
					.replace("%subject%", message.mime2DecodedSubject)
					.replace("%fromName%", authorName ? authorName.trim() : authorMail.trim())
					.replace("%fromMail%", authorMail.trim())
					.replace("%filename%", filenameWithoutExtension);
			} else {
				filename = filenameWithoutExtension;
			}

			// Check if the same filename has already been added to the collection and add appropriate number
			const targetFilename = encodeURI(filename + filenameExtension);
			const usedFilenameCount = usedFilenames[targetFilename] || 0;
			usedFilenames[targetFilename] = usedFilenameCount + 1;
			if (usedFilenameCount > 0) {
				// if name has already been used, add counter to make it unique
				return encodeURI(filename + "_" + usedFilenameCount + filenameExtension);
			}
			return targetFilename;
		};


		return {
			attachmentExtractorApi: {
				async getListLimitedTo(longList, limitTo) {
					return prepareFilesNamesForDisplaying(longList, limitTo || MAX_FILENAMES_FOR_DIALOG);
				},
				async saveFileTo(file, filePath) {
					// console.debug(`Save filePath as ${filePath}`);
					try {
						if (await IOUtils.exists(filePath)) {
							if (!Services.prompt.confirm(null, "Are you sure?", `File '${filePath}' already exists.\nDo you want to overwrite the file over there?`)) {
								return false;
							}
							console.warn(`Overwriting of file '${filePath}' has been confirmed by user.`)
						}

						const byteArray = await file.bytes();
						// console.debug(`read file content into byte array of size ${byteArray.byteLength}.`);

						// save bytes to file
						const success = await IOUtils.write(filePath, byteArray);
						return success;
					}
					catch (ex) {
						Services.prompt.alert(null, `Exception in saveFileTo for file ${filePath}:`, ex.toString());
				 		return false;
					}
				},
				async askUserForFilenameFormat() {
					// Ask user for preferred attachment filename format
					useTemplate = Services.prompt.prompt(null, "Input your preferred filename template", "Placeholders you can use: %date%, %time%, %fromMail%, %subject%, %filename%. Press Cancel if you want to use just the original filenames.", filenameFormat, null, {});

					if (!filenameFormat.value) {
						Services.prompt.alert(null, "Warning", "You have to enter a template for your files or press Cancel.");
						return;
					}
				},
				async askUserForDestinationFolder() {
					const previousPath = (selectedFolder ? selectedFolder.path : "");
					const window = Services.wm.getMostRecentWindow("mail:3pane");
					let filePicker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
					filePicker.init(window.browsingContext, "Save Attachments", filePicker.modeGetFolder);
					selectedFolder = await new Promise(resolve => {
						filePicker.open(rv => {
							if (rv != Ci.nsIFilePicker.returnOK || !filePicker.file) {
								resolve(null)
							} else {
								resolve(filePicker.file);
							}
						});
					});
					if (selectedFolder && (selectedFolder.path != previousPath))
					{
						// reset filenames for collision check
						usedFilenames = {};
					}
					return (selectedFolder && selectedFolder.isDirectory());
				},
				async getFilePathForAttachment(messageId, attachmentName) {
					const filename = getFilenameForAttachment(messageId, attachmentName);
					return PathUtils.join(selectedFolder.path, decodeURIComponent(filename).replace(/[\\/:\*\?\"<>|]/g, "_"));
				},
				async showAlertToUser(title, text) {
					try {
						Services.prompt.alert(null, title, text);
					}
					catch (ex) {
						Services.wm.getMostRecentWindow("mail:3pane").alert("Error: " + ex.toString());
					}
				},
				async showPromptToUser(title, text) {
					try {
						return Services.prompt.confirm(null, title, text);
					}
					catch (ex) {
						Services.wm.getMostRecentWindow("mail:3pane").alert("Error: " + ex.toString());
					}
					return false;
				}
			}
		}
	}
};
