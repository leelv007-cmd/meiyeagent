export default [
  {
    assert: [
      {
        type: 'javascript',
        value: 'JSON.parse(output).passed === true',
      },
    ],
    description:
      'Merchant-language assertion control rejects an explicit false result',
    vars: {
      caseId: 'merchant-language-assertion-control',
    },
  },
];
