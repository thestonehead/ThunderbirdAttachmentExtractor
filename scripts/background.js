browser.menus.create({
  id: "extract-attachments",
  title: "Extract attachments",
  contexts: ["message_list"]
}, onCreated);


browser.menus.onClicked.addListener(onClicked);

async function onClicked(info, tab){
	if (info.menuItemId != "extract-attachments")
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
	let currentPage = await browser.mailTabs.getSelectedMessages(tab.id);
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

	// Call Experiment API to detach attachments from selected messages
	await browser.attachmentExtractorApi.detachAttachmentsFromSelectedMessages(allMessages);
}


function onCreated() {
}

