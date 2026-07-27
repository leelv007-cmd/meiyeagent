export default class MerchantLanguageFalseControlProvider {
  id() {
    return 'meiye:merchant-language-assertion-control';
  }

  async callApi() {
    return {
      output: JSON.stringify({
        caseId: 'merchant-language-assertion-control',
        passed: false,
      }),
    };
  }
}
