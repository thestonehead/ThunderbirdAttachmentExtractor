var { MailServices } = ChromeUtils.import("resource:///modules/MailServices.jsm");

var attachmentExtractorApi = class extends ExtensionCommon.ExtensionAPI {
	getAPI(context) {
		// Constants
		const MAX_FILENAMES_FOR_DIALOG = 20;


		// Helper inline function for preparing filenames for displaying to the user
		const prepareFilesNamesForDisplaying = function (filenames) {
			const filteredFileNames = filenames.map(s => s.trim()).filter(s => s.length > 0);
			if (filteredFileNames.length > MAX_FILENAMES_FOR_DIALOG) {
				const slicedFileNames = filteredFileNames.slice(0, MAX_FILENAMES_FOR_DIALOG);
				slicedFileNames.push(`and ${filteredFileNames.length - MAX_FILENAMES_FOR_DIALOG} more`);
				return slicedFileNames;
			} else {
				return filteredFileNames;
			}
		};

		const processMessages = function(messages, filenameFormat, useTemplate, messageServiceFromURI) {
			const usedFilenames = {};
			const types = [];
			const attachmentUrls = [];
			const filenames = [];
			const originalFilenames = [];
			const messageUrls = [];
			const deletedFiles = [];
			for (let msg of messages) {
				let folder = context.extension.folderManager.get(msg.account, msg.folder);
				let message = context.extension.messageManager.get(msg.id);
				let messageUri = folder.getUriForMsg(message);
				let messageService = messageServiceFromURI(messageUri);
				let attachmentUriBase = messageService.getUrlForUri(messageUri).spec;

				// Detachment data per message
				let msgTypes = [];
				let msgAttachmentUrls = [];
				let msgFilenames = [];
				let msgOriginalFilenames = [];
				let msgMessageUrls = [];

				for (let attachment of msg.attachments) {
					// If the attachment is already deleted, skip from processing
					if (attachment.contentType == "text/x-moz-deleted") {
						deletedFiles.push(attachment.name);
						continue;
					}

					// Handle filename
					let filename = filenameFormat.value;
					let [_, filenameWithoutExtension, filenameExtension] = attachment.name.match(/(.*)(\..*)$/) || [null, attachment.name, ""];
					if (useTemplate) {
						const authorRegex = /(.*)?<(.*)>/;
						let [_, authorName, authorMail] = message.mime2DecodedAuthor.match(authorRegex) || [null, null, message.mime2DecodedAuthor];
						let [messageDate, messageTime] = (new Date(message.date / 1000)).toISOString().split("T");
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
					let usedFilenameCount = usedFilenames[encodeURI(filename + filenameExtension)];
					if (usedFilenameCount) {
						let adjustedFilename = filename;
						msgFilenames.push(encodeURI(adjustedFilename + "_" + usedFilenameCount + filenameExtension));
					}
					else {
						msgFilenames.push(encodeURI(filename + filenameExtension));
					}
					msgOriginalFilenames.push(encodeURI(attachment.name)); //Save original attachment filename to be able to delete them afterwards
					usedFilenames[encodeURI(filename + filenameExtension)] = (usedFilenameCount || 0) + 1;

					// Handle content type, attachment and message urls
					msgTypes.push(attachment.contentType);
					msgAttachmentUrls.push(attachmentUriBase + (attachmentUriBase.indexOf('?') >= 0 ? "&" : "?") + `part=${attachment.partName}&filename=${encodeURI(attachment.name)}`);
					msgMessageUrls.push(messageUri)
				}
				types.push(msgTypes);
				attachmentUrls.push(msgAttachmentUrls);
				filenames.push(msgFilenames);
				messageUrls.push(msgMessageUrls);
				originalFilenames.push(msgOriginalFilenames);
			}
			return [types, attachmentUrls, filenames, messageUrls, originalFilenames, deletedFiles];
		};

		return {
			attachmentExtractorApi: {
				async detachAttachmentsFromSelectedMessages(messages) {


					// Ask user for preferred attachment filename format
					let filenameFormat = { value: "%date%_%fromMail%_%subject%_%filename%" };
					const useTemplate = Services.prompt.prompt(null, "Input your preferred filename template", "Placeholders you can use: %date%, %time%, %fromMail%, %subject%, %filename%. Press Cancel if you want to use just the original filenames.", filenameFormat, null, {});

					if (!filenameFormat.value) {
						Services.prompt.alert(null, "Warning", "You have to enter a template for your files or press Cancel.");
						return;
					}


					try {
						let window = Services.wm.getMostRecentWindow("mail:3pane");
						let messenger = window.messenger;
						// Former is TB115, later is TB102.
						const messageServiceFromURI = MailServices.messageServiceFromURI || messenger.messageServiceFromURI;

						// Keep track of used filenames to ensure no overlap by adding _# at the end
						const [types, attachmentUrls, filenames, messageUrls, originalFilenames, deletedFiles] = processMessages(messages, filenameFormat, useTemplate, messageServiceFromURI);

						// Notify user about files that can't be saved
						if (deletedFiles.length > 0) {
							Services.prompt.alert(null, "Some files can't be saved", "These files have already been deleted and cannot be saved:\n" + prepareFilesNamesForDisplaying(deletedFiles.flat()).join("\n"));
							// Don't continue if all of the files are already deleted
							if (types.flat().length == 0) {
								return;
							}
						}

						// messenger.detachAllAttachments throws and exception when attachments from multiple messages are given
						// Therefore we work around by first saving all of the attachments to a selected folder.
						// There are reports, that saving sometimes fails. Lets save message by message and wait for its completion.
						let filePicker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
						filePicker.init(window, "Save Attachmets", filePicker.modeGetFolder);
						let selectedFolder = await new Promise(resolve => {
							filePicker.open(rv => {
								if (rv != Ci.nsIFilePicker.returnOK || !filePicker.file) {
									resolve(null)
								} else {
									resolve(filePicker.file);
								}
							});
						});
						if (!selectedFolder || !selectedFolder.isDirectory()) {
							return;
						}

						for (let m = 0; m < messages.length; m++) {
							for (let i = 0; i < filenames[m].length; i++) {
								let filename = filenames[m][i];
								let attachmentUrl = attachmentUrls[m][i];
								let type = types[m][i];
								let messageUrl = messageUrls[m][i];

								let targetDir = selectedFolder.clone();
								targetDir.append(decodeURIComponent(filename).replace(/[\\/:\*\?\"<>|]/g, "_"));
								let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
								file.initWithPath(targetDir.path);

								let success = await new Promise(resolve => {
									let urlListener = {
										OnStartRunningUrl(url) { },
										OnStopRunningUrl(url, status) {
											resolve(Components.isSuccessCode(status));
										},
									};
									messenger.saveAttachmentToFile(
										file,
										attachmentUrl,
										messageUrl,
										type,
										urlListener
									);
								});
								if (!success) {
									Services.prompt.alert(null, "Save Attachments", "Could not save attachment, aborting.");
									return;
								}
							}
						}
						Services.prompt.alert(null, "Save Attachments", "Attachments saved. Please check the selected folder.");
					}
					catch (ex) {
						Services.wm.getMostRecentWindow("mail:3pane").alert("Error: " + ex.toString());
					}
				},
				showAlertToUser(title, text) {
					try {
						Services.prompt.alert(null, title, text);
					}
					catch (ex) {
						Services.wm.getMostRecentWindow("mail:3pane").alert("Error: " + ex.toString());
					}
				},
				deleteAttachmentsFromSelectedMessages(messages) {
					try {
						const window = Services.wm.getMostRecentWindow("mail:3pane");
						const messenger = window.messenger;
						// Former is TB115, later is TB102.
						const messageServiceFromURI = MailServices.messageServiceFromURI || messenger.messageServiceFromURI;
						const [types, attachmentUrls, , messageUrls,  originalFilenames, ] = processMessages(messages, "", undefined, messageServiceFromURI);
						const filenames = originalFilenames;

						// And then after checking with the user, we delete attachments message by message without further prompts
						if (Services.prompt.confirm(null, "Are you sure", "Do you wish to delete these attachments from your e-mails? (Irreversible!)\n" + prepareFilesNamesForDisplaying(filenames.flat()).join("\n"))) {
							for (let i in messages) {
								if (types[i].length == 0) {
									continue;
								}
								messenger.detachAllAttachments(
									types[i],
									attachmentUrls[i],
									filenames[i],
									messageUrls[i],
									false,
									true
								);
							}
							Services.prompt.alert(null, "Delete Attachments", "Attachments detached.");
						}
					} catch (ex) {
						Services.wm.getMostRecentWindow("mail:3pane").alert("Error: " + ex.toString());
					}
				}
			}
		}
	}
};
