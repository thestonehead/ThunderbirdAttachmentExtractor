browser.menus.create({
  id: "extract-attachments",
  title: "Extract attachments",
  contexts: ["message_list"]
}, onCreated);
browser.menus.create({
  id: "delete-attachments",
  title: "Delete attachments",
  contexts: ["message_list"]
}, onCreated);


browser.menus.onClicked.addListener(onClicked);

/**
 * Helper function to find the full mime details of a part.
 */
function findPart(parts, partName) {
	for (let part of parts || []) {
		if (part.partName == partName) {
			return part;
		}
		const entry = findPart(part.parts, partName);
		if (entry) {
			return entry;
		}
	}
	return null;
}

async function onClicked(info, tab){
	if (info.menuItemId != "extract-attachments" && info.menuItemId != "delete-attachments")  
		return;
		
	
	var allMessages = [];
	// Helper inline function for getting attachment details from a message
	const createMessage = async function(message){
		const attachments = await browser.messages.listAttachments(message.id);
		return {
			id: message.id,
			account: message.folder.accountId,
			folder: message.folder.path,
			attachments: attachments
		};
	}

	// Get first page of messages
	let currentPage = info.selectedMessages;
	if (currentPage.messages.length == 0){
		browser.attachmentExtractorApi.showAlertToUser("Oops", "No message selected. Please select a message (or multiple) with an attachment.");
		return;
	}
	
	// Iterate through the messages
	for (let m of currentPage.messages) {
		allMessages.push(await createMessage(m));
	}
	// As long as there is an ID, more pages can be fetched
	while (currentPage.id) {
		currentPage = await browser.messages.continueList(currentPage.id);
		for (let m of currentPage.messages) {
			allMessages.push(await createMessage(m));
		}
	}

	if (info.menuItemId == "extract-attachments") {
		// Call Experiment API to detach attachments from selected messages
		await browser.attachmentExtractorApi.detachAttachmentsFromSelectedMessages(allMessages);
	}
	else if (info.menuItemId == "delete-attachments")  
	{
		await browser.attachmentExtractorApi.deleteAttachmentsFromSelectedMessages(allMessages);
	}else {
		browser.attachmentExtractorApi.showAlertToUser("Oops", "Unknown action.");
	}
	
}


function onCreated() {
}

